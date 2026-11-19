import assert from "node:assert/strict";
import test from "node:test";
import type { FocusSessionDto, FocusCurrentSessionResult } from "../server/features/focus/types";
import type { FocusApi } from "../src/features/focus/api/focusApi";
import { createFocusRuntimeController } from "../src/features/focus/runtime/controller";
import type { FocusLifecycle } from "../src/features/focus/runtime/lifecycle";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "11111111-1111-4111-8111-999999999999";
const SERVER_NOW = "2026-11-19T20:00:00.000Z";
function focus(status: FocusSessionDto["status"] = "ACTIVE", id = ID): FocusSessionDto {
  return {
    id, planId: "22222222-2222-4222-8222-222222222222",
    planItemId: "33333333-3333-4333-8333-333333333333",
    lectureId: "lecture-1", status,
    startedAt: "2026-11-19T19:55:00.000Z", plannedEndAt: "2026-11-19T20:25:00.000Z",
    actualEndedAt: null, lastCheckpointAt: SERVER_NOW,
    activeSeconds: 300, pauseSeconds: 0, serverNow: SERVER_NOW,
    elapsedActiveSeconds: 300, remainingSeconds: 1500,
    completionEligible: false, sessionNumber: 1, plannedSessionCount: 3,
    isLastPlannedSession: false, reconciliationRequired: false, completionReason: null,
  };
}
const result = (session: FocusSessionDto | null): FocusCurrentSessionResult => ({ session, serverNow: SERVER_NOW });
function timerOptions(read: (canonical: boolean) => Promise<FocusCurrentSessionResult>) {
  let now = 50_000;
  const runtime = createFocusRuntimeController({
    cache: null,
    lifecycle: null,
    clock: { monotonicNow: () => now },
    api: { getCurrentFocusSession: (options) => read(options?.canonical === true) } as FocusApi,
    setTimer: (() => ({ unref() {} } as ReturnType<typeof setTimeout>)),
    clearTimer: (() => {}),
  });
  return { runtime, advance: (ms: number) => { now += ms; } };
}

test("replica null during resource return must not replace a live canonical session", async () => {
  let reads = 0;
  const { runtime } = timerOptions(async (canonical) => {
    reads += 1;
    if (reads === 2) return result(null); // lagging D1 read
    assert.equal(canonical, reads === 3);
    return result(focus("ACTIVE"));
  });
  try {
    await runtime.initialize();
    const seen: Array<string | null> = [];
    runtime.subscribe((state) => seen.push(state.session?.id ?? null));
    await runtime.reconcile();
    assert.equal(reads, 3);
    assert.equal(runtime.getState().session?.id, ID);
    assert.ok(seen.every((id) => id === ID), "never emit an obsolete/empty route");
  } finally { runtime.dispose(); }
});

test("replica returns a different session; canonical confirmation preserves owned route", async () => {
  let reads = 0;
  const { runtime } = timerOptions(async (canonical) => {
    reads += 1;
    if (reads === 2) return result(focus("ACTIVE", OTHER_ID));
    assert.equal(canonical, reads === 3);
    return result(focus("ACTIVE"));
  });
  try {
    await runtime.initialize();
    const seen: Array<string | null> = [];
    runtime.subscribe((state) => seen.push(state.session?.id ?? null));
    await runtime.reconcile();
    assert.equal(reads, 3);
    assert.ok(seen.every((id) => id === ID));
  } finally { runtime.dispose(); }
});

test("handoff replica shows ACTIVE, strong read confirms RESOURCE_HANDOFF", async () => {
  let reads = 0;
  const { runtime } = timerOptions(async (canonical) => {
    reads += 1;
    if (reads === 2) return result(focus("ACTIVE"));
    assert.equal(canonical, reads === 3);
    return result(focus("RESOURCE_HANDOFF"));
  });
  try {
    await runtime.initialize();
    const seen: Array<string | null> = [];
    runtime.subscribe((state) => seen.push(state.session?.status ?? null));
    await runtime.reconcile();
    assert.equal(reads, 3);
    assert.ok(seen.every((status) => status === "RESOURCE_HANDOFF"));
  } finally { runtime.dispose(); }
});

test("return to foreground recalculates display before pending server read resolves", async () => {
  let now = 50_000;
  let onForeground: (() => void | Promise<void>) | null = null;
  let resolveRead: ((value: FocusCurrentSessionResult) => void) | null = null;
  let reads = 0;
  const lifecycle: FocusLifecycle = {
    subscribe: (callback) => { onForeground = callback; return () => { onForeground = null; }; },
  };
  const runtime = createFocusRuntimeController({
    cache: null, lifecycle,
    clock: { monotonicNow: () => now },
    api: { getCurrentFocusSession: async () => {
      reads += 1;
      if (reads === 1) return result(focus("ACTIVE"));
      return new Promise<FocusCurrentSessionResult>((resolve) => { resolveRead = resolve; });
    } } as FocusApi,
    setTimer: (() => ({ unref() {} } as ReturnType<typeof setTimeout>)),
    clearTimer: (() => {}),
  });
  try {
    await runtime.initialize();
    assert.equal(runtime.getState().displayRemainingSeconds, 1500);
    now += 38_000;
    const action = onForeground!();
    assert.equal(runtime.getState().displayRemainingSeconds, 1462,
      "the first foreground frame must show elapsed time without network");
    await Promise.resolve();
    assert.ok(resolveRead, "server reconciliation should still run");
    resolveRead!(result(focus("ACTIVE")));
    await action;
  } finally { runtime.dispose(); }
});

test("PAUSED remains frozen even after returning from background", async () => {
  const { runtime, advance } = timerOptions(async () => result(focus("PAUSED")));
  try {
    await runtime.initialize();
    assert.equal(runtime.getState().displayRemainingSeconds, 1500);
    advance(90_000);
    runtime.refreshDisplay();
    assert.equal(runtime.getState().displayRemainingSeconds, 1500);
  } finally { runtime.dispose(); }
});

test("RESOURCE_HANDOFF counts elapsed time while external resource owns focus", async () => {
  const { runtime, advance } = timerOptions(async () => result(focus("RESOURCE_HANDOFF")));
  try {
    await runtime.initialize();
    advance(56_000);
    runtime.refreshDisplay();
    assert.equal(runtime.getState().displayRemainingSeconds, 1444);
  } finally { runtime.dispose(); }
});

test("genuinely different canonical session is accepted after confirmation", async () => {
  let calls = 0;
  const { runtime } = timerOptions(async () => {
    calls += 1;
    return result(focus("ACTIVE", calls === 1 ? ID : OTHER_ID));
  });
  try {
    await runtime.initialize();
    await runtime.reconcile();
    assert.equal(calls, 3, "the replica mismatch must trigger strong confirmation");
    assert.equal(runtime.getState().session?.id, OTHER_ID,
      "do not hold on to an obsolete session after canonical confirmation");
  } finally { runtime.dispose(); }
});

test("confirmed session ending is not hidden or resurrected", async () => {
  let calls = 0;
  const { runtime } = timerOptions(async () => {
    calls += 1;
    return calls === 1 ? result(focus("ACTIVE")) : result(null);
  });
  try {
    await runtime.initialize();
    await runtime.reconcile();
    assert.equal(calls, 3);
    assert.equal(runtime.getState().session, null);
    assert.equal(runtime.getState().runtimeStatus, "IDLE");
  } finally { runtime.dispose(); }
});
