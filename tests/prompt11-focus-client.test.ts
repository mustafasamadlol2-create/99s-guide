import assert from "node:assert/strict";
import test from "node:test";
import type {
  FocusCurrentSessionResult,
  FocusSessionDto,
  FocusSessionMutationResult,
} from "../server/features/focus/types";
import { createFocusApi, type FocusApi, type FocusApiRequestOptions } from "../src/features/focus/api/focusApi";
import {
  createFocusRuntimeController,
  type FocusLifecycle,
} from "../src/features/focus/runtime";

const id = "11111111-1111-4111-8111-111111111111";
const now = "2026-09-25T12:00:00.000Z";

function session(status: FocusSessionDto["status"] = "ACTIVE", remainingSeconds = 600): FocusSessionDto {
  return {
    id, planId: id, planItemId: id, lectureId: id, status,
    startedAt: now, plannedEndAt: now, actualEndedAt: null, lastCheckpointAt: now,
    activeSeconds: 0, pauseSeconds: 0, serverNow: now, elapsedActiveSeconds: 0,
    remainingSeconds, completionEligible: false, sessionNumber: 1, plannedSessionCount: 1,
    isLastPlannedSession: false, reconciliationRequired: false, completionReason: null,
  };
}
const current = (value: FocusSessionDto | null): FocusCurrentSessionResult => ({ session: value, serverNow: now });
const mutation = (value: FocusSessionDto): FocusSessionMutationResult => ({ session: value, idempotency: "FIRST_SEEN" });

class Lifecycle implements FocusLifecycle {
  foregroundCallback: (() => void | Promise<void>) | null = null;
  backgroundCallback: (() => void) | null = null;
  subscribe(foreground: () => void | Promise<void>, background?: () => void): () => void {
    this.foregroundCallback = foreground;
    this.backgroundCallback = background ?? null;
    return () => { this.foregroundCallback = null; this.backgroundCallback = null; };
  }
  background(): void { this.backgroundCallback?.(); }
  foreground(): Promise<void> { return Promise.resolve(this.foregroundCallback?.()); }
}

function api(overrides: Partial<FocusApi> = {}): FocusApi {
  return {
    getCurrentFocusSession: async () => current(session()),
    startFocusSession: async () => mutation(session()),
    pauseFocusSession: async () => mutation(session("PAUSED")),
    resumeFocusSession: async () => mutation(session()),
    completeFocusSession: async () => mutation(session("COMPLETED", 0)),
    abandonFocusSession: async () => mutation(session("ABANDONED", 0)),
    createFocusPlan: async () => { throw new Error("unused"); },
    listFocusPlans: async () => [],
    getFocusPlan: async () => { throw new Error("unused"); },
    updateFocusPlan: async () => { throw new Error("unused"); },
    archiveFocusPlan: async () => { throw new Error("unused"); },
    createQuickNote: async () => { throw new Error("unused"); },
    listQuickNotes: async () => [],
    getQuickNote: async () => { throw new Error("unused"); },
    updateQuickNote: async () => { throw new Error("unused"); },
    archiveQuickNote: async () => { throw new Error("unused"); },
    convertQuickNote: async () => { throw new Error("unused"); },
    getMetrics: async () => { throw new Error("unused"); },
    getPostFocusActionContext: async () => { throw new Error("unused"); },
    getSessionSummary: async () => { throw new Error("unused"); },
    listHistory: async () => ({ items: [], nextCursor: null, limit: 20 }),
    ...overrides,
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("Prompt 11 API sends handoff/interruption routes and rejects malformed mutation DTOs", async () => {
  const calls: Array<{ path: string; options: FocusApiRequestOptions }> = [];
  const client = createFocusApi(async (path, options = {}) => {
    calls.push({ path: String(path), options });
    if (String(path).endsWith("/interruptions")) return response({ idempotency: "FIRST_SEEN" });
    return response({ session: session(String(path).includes("/return") ? "ACTIVE" : "RESOURCE_HANDOFF"), idempotency: "FIRST_SEEN" });
  });
  await client.startResourceHandoff!(id, { resourceType: "PDF", resourceId: id, idempotencyKey: "handoff-1", source: "ios" });
  await client.returnFromResourceHandoff!(id, { targetState: "ACTIVE", idempotencyKey: "return-1", source: "ios" });
  await client.recordInterruption!(id, { observedAwaySeconds: 20, reason: "background_absence", idempotencyKey: "interrupt-1", source: "ios" });
  assert.deepEqual(calls.map(({ path }) => path), [
    `/api/focus/sessions/${id}/handoff/start`,
    `/api/focus/sessions/${id}/handoff/return`,
    `/api/focus/sessions/${id}/interruptions`,
  ]);
  assert.deepEqual(JSON.parse(String(calls[0].options.body)), {
    resourceType: "PDF", resourceId: id, idempotencyKey: "handoff-1", source: "ios",
  });
  const malformed = createFocusApi(async () => response({ idempotency: "FIRST_SEEN" }));
  await assert.rejects(malformed.startResourceHandoff!(id, {
    resourceType: "PDF", resourceId: id, idempotencyKey: "handoff-1", source: "ios",
  }), /Invalid Focus session/);
});

function controllerFor(
  focusApi: FocusApi,
  lifecycle = new Lifecycle(),
  keyFactory: () => string = () => "stable-key",
) {
  let monotonic = 0;
  const controller = createFocusRuntimeController({
    api: focusApi, lifecycle, cache: null, accountId: "prompt11",
    source: () => "ios", idempotencyKeyFactory: keyFactory,
    clock: { monotonicNow: () => monotonic },
  });
  return { controller, lifecycle, advance: (seconds: number) => { monotonic += seconds * 1000; } };
}

test("handoff starts canonically before opener; opener failure returns with the same stable key", async () => {
  const calls: string[] = [];
  const handoffApi = api({
    startResourceHandoff: async (_sessionId, input) => {
      calls.push(`start:${input.idempotencyKey}`);
      return mutation(session("RESOURCE_HANDOFF"));
    },
    returnFromResourceHandoff: async (_sessionId, input) => {
      calls.push(`return:${input.idempotencyKey}`);
      return mutation(session("ACTIVE"));
    },
  });
  const { controller } = controllerFor(handoffApi, undefined, (() => {
    let n = 0; return () => `key-${++n}`;
  })());
  await controller.initialize();
  await assert.rejects(controller.openResourceWithHandoff(
    { resourceType: "PDF", resourceId: id },
    () => { calls.push("open"); throw new Error("opener failed"); },
  ), /opener failed/);
  assert.deepEqual(calls, ["start:key-1", "open", "return:key-2"]);
  controller.dispose();
});

test("a second handoff for a different resource is rejected while the first is in flight", async () => {
  let resolveStart!: (result: FocusSessionMutationResult) => void;
  const handoffApi = api({
    startResourceHandoff: async () => new Promise((resolve) => { resolveStart = resolve; }),
  });
  const { controller } = controllerFor(handoffApi);
  await controller.initialize();
  const first = controller.startResourceHandoff({ resourceType: "PDF", resourceId: id });
  await assert.rejects(
    controller.startResourceHandoff({ resourceType: "VIDEO", resourceId: `${id.slice(0, -1)}2` }),
    /mutation is already in progress/i,
  );
  resolveStart(mutation(session("RESOURCE_HANDOFF")));
  await first;
  controller.dispose();
});

test("foreground handoff return is single-flight and a different resource cannot race the start", async () => {
  let returns = 0;
  let resolveReturn!: (result: FocusSessionMutationResult) => void;
  const handoffApi = api({
    getCurrentFocusSession: async () => current(session("RESOURCE_HANDOFF")),
    returnFromResourceHandoff: async () => {
      returns += 1;
      return new Promise((resolve) => { resolveReturn = resolve; });
    },
    startResourceHandoff: async () => mutation(session("RESOURCE_HANDOFF")),
  });
  const { controller, lifecycle } = controllerFor(handoffApi);
  await controller.initialize();
  const first = lifecycle.foreground();
  const second = lifecycle.foreground();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(returns, 1);
  resolveReturn(mutation(session("ACTIVE")));
  await Promise.all([first, second]);
  controller.dispose();
});

test("ambiguous return retry reuses its key and stale current cannot overwrite ACTIVE", async () => {
  const keys: string[] = [];
  let attempt = 0;
  const handoffApi = api({
    getCurrentFocusSession: async () => current(session("RESOURCE_HANDOFF")),
    returnFromResourceHandoff: async (_id, input) => {
      keys.push(input.idempotencyKey);
      if (++attempt === 1) throw new Error("response lost");
      return mutation(session("ACTIVE"));
    },
  });
  const { controller } = controllerFor(handoffApi);
  await controller.initialize();
  await assert.rejects(controller.returnFromResourceHandoff(), /response lost/);
  await controller.returnFromResourceHandoff();
  assert.equal(keys[0], keys[1]);
  controller.dispose();
});

test("canonical ACTIVE reconciliation releases a resolved handoff return key", async () => {
  const returnKeys: string[] = [];
  let currentStatus: FocusSessionDto["status"] = "RESOURCE_HANDOFF";
  let keyNumber = 0;
  const handoffApi = api({
    getCurrentFocusSession: async () => current(session(currentStatus)),
    returnFromResourceHandoff: async (_id, input) => {
      returnKeys.push(input.idempotencyKey);
      if (returnKeys.length === 1) throw new Error("response lost");
      currentStatus = "ACTIVE";
      return mutation(session("ACTIVE"));
    },
    startResourceHandoff: async () => {
      currentStatus = "RESOURCE_HANDOFF";
      return mutation(session("RESOURCE_HANDOFF"));
    },
  });
  const { controller } = controllerFor(handoffApi, undefined, () => `handoff-key-${++keyNumber}`);
  await controller.initialize();
  await assert.rejects(controller.returnFromResourceHandoff(), /response lost/);
  currentStatus = "ACTIVE";
  await controller.reconcile();
  await controller.startResourceHandoff({ resourceType: "PDF", resourceId: id });
  await controller.returnFromResourceHandoff();
  assert.notEqual(returnKeys[0], returnKeys[1]);
  controller.dispose();
});

test("handoff background is suppressed; generic background creates one candidate only above 20 seconds", async () => {
  const lifecycle = new Lifecycle();
  let currentSession = session("RESOURCE_HANDOFF");
  let records = 0;
  const handoffApi = api({
    getCurrentFocusSession: async () => current(currentSession),
    returnFromResourceHandoff: async () => {
      currentSession = session("ACTIVE");
      return mutation(currentSession);
    },
    recordInterruption: async () => { records += 1; return { idempotency: "FIRST_SEEN" }; },
  });
  const { controller, advance } = controllerFor(handoffApi, lifecycle);
  await controller.initialize();
  lifecycle.background(); advance(60); await lifecycle.foreground(); await settle();
  assert.equal(controller.getState().potentialInterruption, null);
  currentSession = session("ACTIVE", 300);
  lifecycle.background(); advance(21); await lifecycle.foreground(); await settle();
  const candidate = controller.getState().potentialInterruption;
  assert.equal(candidate?.authority, "CLIENT_OBSERVED");
  assert.equal(records, 0);
  lifecycle.background(); advance(10); await lifecycle.foreground(); await settle();
  assert.equal(controller.getState().potentialInterruption?.observedAwaySeconds, 21);
  controller.dispose();
});

test("potential interruption duration is capped by six hours and remaining Focus time", async () => {
  for (const scenario of [
    { awaySeconds: 7 * 60 * 60, remainingSeconds: 6 * 60 * 60, expectedSeconds: 6 * 60 * 60 },
    { awaySeconds: 120, remainingSeconds: 45, expectedSeconds: 45 },
  ]) {
    const lifecycle = new Lifecycle();
    const focusApi = api({
      getCurrentFocusSession: async () => {
        const currentSession = session("ACTIVE", scenario.remainingSeconds);
        currentSession.plannedEndAt = new Date(
          Date.parse(now) + scenario.remainingSeconds * 1_000,
        ).toISOString();
        return current(currentSession);
      },
    });
    const { controller, advance } = controllerFor(focusApi, lifecycle);
    await controller.initialize();
    lifecycle.background();
    advance(scenario.awaySeconds);
    await lifecycle.foreground();
    await settle();
    assert.equal(controller.getState().potentialInterruption?.observedAwaySeconds, scenario.expectedSeconds);
    controller.dispose();
  }
});

test("short background creates no candidate; explicit interruption retry reuses key", async () => {
  const lifecycle = new Lifecycle();
  const keys: string[] = [];
  let fail = true;
  const interruptionApi = api({
    recordInterruption: async (_id, input) => {
      keys.push(input.idempotencyKey);
      if (fail) { fail = false; throw new Error("response lost"); }
      return { idempotency: "REPLAY_SAME_PAYLOAD" };
    },
  });
  const { controller, advance } = controllerFor(interruptionApi, lifecycle, (() => {
    let n = 0; return () => `key-${++n}`;
  })());
  await controller.initialize();
  lifecycle.background(); advance(10); await lifecycle.foreground(); await settle();
  assert.equal(controller.getState().potentialInterruption, null);
  lifecycle.background(); advance(30); await lifecycle.foreground(); await settle();
  await assert.rejects(controller.recordInterruption(), /response lost/);
  await controller.recordInterruption();
  assert.deepEqual(keys, ["key-1", "key-1"]);
  assert.equal(controller.getState().potentialInterruption, null);
  controller.dispose();
});