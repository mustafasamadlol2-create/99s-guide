import test from "node:test";
import assert from "node:assert/strict";
import { nextUnfinishedFocusPlanItem } from "../server/features/focus/planSelection.js";
import { buildFocusTimerSnapshot } from "../server/features/focus/timer.js";
import { parseStudyEventPayload } from "../server/features/study-events/schemas.js";
import { createFocusApi } from "../src/features/focus/api/focusApi.js";
import { createFocusTimerBaseline, estimateFocusDisplay } from "../src/features/focus/runtime/timer.js";
import type { FocusSessionDto } from "../server/features/focus/types.js";

const t0 = "2026-11-18T01:00:00.000Z";
const id = "00000000-0000-4000-8000-000000000001";
const items = [
  { id: "first", sequence: 1, sessionCount: 1 },
  { id: "second", sequence: 2, sessionCount: 2 },
  { id: "third", sequence: 3, sessionCount: 1 },
];

test("new Focus start advances past completed first item without resetting history", async () => {
  const counts: Record<string, number> = { first: 1, second: 1, third: 0 };
  const picked = await nextUnfinishedFocusPlanItem(items, "first", async (item) => counts[item]);
  assert.deepEqual(picked, { item: items[1], priorCompletedCount: 1 });
  assert.equal(counts.first, 1);
});

test("requested partially completed item keeps its own session allowance", async () => {
  const picked = await nextUnfinishedFocusPlanItem(items, "second", async (id) => ({ first: 1, second: 1, third: 0 })[id as "first"|"second"|"third"]);
  assert.equal(picked?.item.id, "second");
  assert.equal(picked?.priorCompletedCount, 1);
});

test("fully finished Focus plan returns no item and must create a fresh plan for the next cycle", async () => {
  const picked = await nextUnfinishedFocusPlanItem(items, "first", async (id) => ({ first: 1, second: 2, third: 1 })[id as "first"|"second"|"third"]);
  assert.equal(picked, null);
});

test("invalid/foreign requested item cannot be selected", async () => {
  assert.equal(await nextUnfinishedFocusPlanItem(items, "foreign", async () => 0), null);
});

function focus(status: FocusSessionDto["status"]): FocusSessionDto {
  return {
    id, planId: id, planItemId: id, lectureId: "lecture-1", status,
    startedAt: t0, plannedEndAt: "2026-11-18T01:25:00.000Z",
    actualEndedAt: null, lastCheckpointAt: t0,
    activeSeconds: 0, pauseSeconds: 0,
    serverNow: t0, elapsedActiveSeconds: 0, remainingSeconds: 1500,
    completionEligible: false, sessionNumber: 1, plannedSessionCount: 1,
    isLastPlannedSession: true, reconciliationRequired: false, completionReason: null,
  };
}

test("PDF/YouTube handoff keeps counting while PAUSED freezes", () => {
  for (const state of ["ACTIVE", "RESOURCE_HANDOFF"] as const) {
    const session = focus(state);
    const baseline = createFocusTimerBaseline(session, t0, 10_000);
    const display = estimateFocusDisplay(session, baseline, 70_000);
    assert.equal(display.displayRemainingSeconds, 1440);
    assert.equal(display.displayMayBeComplete, false);
  }
  const paused = focus("PAUSED");
  const display = estimateFocusDisplay(paused, createFocusTimerBaseline(paused, t0, 10_000), 70_000);
  assert.equal(display.displayRemainingSeconds, 1500);
});

test("handoff elapsed full duration stays at zero without fabricating completion authority", () => {
  const session = focus("RESOURCE_HANDOFF");
  const display = estimateFocusDisplay(session, createFocusTimerBaseline(session, t0, 0), 1_800_000);
  assert.equal(display.displayRemainingSeconds, 0);
  assert.equal(display.displayMayBeComplete, false);
});


test("server-derived handoff time continues during an external resource visit", () => {
  const serverSession = {
    status: "RESOURCE_HANDOFF" as const,
    startedAt: new Date(t0),
    plannedEndAt: new Date("2026-11-18T01:25:00.000Z"),
    lastCheckpointAt: new Date(t0),
    activeSeconds: 0,
    pauseSeconds: 0,
  };
  const snapshot = buildFocusTimerSnapshot({ session: serverSession, now: new Date("2026-11-18T01:12:00.000Z") });
  assert.equal(snapshot.remainingSeconds, 780);
  assert.equal(snapshot.elapsedActiveSeconds, 720);
  assert.equal(snapshot.completionEligible, false); // return before canonical completion
});

test("old non-completed Focus session probe is silent instead of a global error toast", async () => {
  const calls: Array<{ path: string; silent?: boolean }> = [];
  const api = createFocusApi(async (path, options) => {
    calls.push({ path: String(path), silent: options?.silent });
    return new Response(JSON.stringify({ code: "INVALID_SESSION_STATE" }), {
      status: 409, headers: { "Content-Type": "application/json" },
    });
  });
  await assert.rejects(api.getPostFocusActionContext(id), (error: unknown) =>
    error !== null && typeof error === "object" && "status" in error && error.status === 409);
  assert.equal(calls[0]?.silent, true);
});


test("start event schema accepts both legacy and original-request idempotency payloads", () => {
  assert.deepEqual(parseStudyEventPayload("focus_session_started", {}), {});
  assert.deepEqual(parseStudyEventPayload("focus_session_started", { requestedPlanItemId: id }), { requestedPlanItemId: id });
  assert.throws(() => parseStudyEventPayload("focus_session_started", { requestedPlanItemId: "invalid" }));
});


test("a completed Focus plan is handled by the Start flow, without a transient global error toast", async () => {
  let silent: boolean | undefined;
  const api = createFocusApi(async (_path, options) => {
    silent = options?.silent;
    return new Response(JSON.stringify({ code: "PLANNED_SESSIONS_COMPLETE" }), {
      status: 409, headers: { "Content-Type": "application/json" },
    });
  });
  await assert.rejects(api.startFocusSession({
    planId: id, planItemId: id, idempotencyKey: "solo-restart-001", source: "web",
  }), (error: unknown) =>
    error !== null && typeof error === "object" &&
    "code" in error && error.code === "PLANNED_SESSIONS_COMPLETE");
  assert.equal(silent, true);
});
