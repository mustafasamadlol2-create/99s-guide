import assert from "node:assert/strict";
import test from "node:test";
import {
  abandonFocusTimer, buildFocusTimerSnapshot, completeFocusTimer, pauseFocusTimer,
  resumeFocusTimer, FOCUS_TIMER_COMPLETION_TOLERANCE_SECONDS,
} from "../server/features/focus/timer.js";

const base = (overrides = {}) => ({
  status: "ACTIVE" as const, startedAt: "2025-01-01T00:00:00.000Z",
  plannedEndAt: "2025-01-01T00:45:00.000Z", lastCheckpointAt: "2025-01-01T00:00:00.000Z",
  activeSeconds: 0, pauseSeconds: 0, ...overrides,
});
test("target is persisted start-to-end duration", () => assert.equal(buildFocusTimerSnapshot({ session: base(), now: "2025-01-01T00:01:00Z" }).targetSeconds, 2700));
test("active session becomes eligible at the target with no time remaining", () => {
  const snapshot = buildFocusTimerSnapshot({
    session: base(),
    now: "2025-01-01T00:45:00Z",
  });
  assert.equal(snapshot.completionEligible, true);
  assert.equal(snapshot.remainingSeconds, 0);
});
test("paused timer stays frozen and ineligible after the original planned end", () => {
  const paused = base({
    status: "PAUSED",
    activeSeconds: 600,
    lastCheckpointAt: "2025-01-01T00:10:00Z",
  });
  const snapshot = buildFocusTimerSnapshot({
    session: paused,
    now: "2025-01-01T01:00:00Z",
  });
  assert.equal(snapshot.elapsedActiveSeconds, 600);
  assert.equal(snapshot.remainingSeconds, 2100);
  assert.equal(snapshot.completionEligible, false);
});
test("normal timer completion rejects a paused session", () => {
  const action = completeFocusTimer(
    base({
      status: "PAUSED",
      activeSeconds: 600,
      lastCheckpointAt: "2025-01-01T00:10:00Z",
    }),
    "2025-01-01T01:00:00Z",
  );
  assert.equal(action.status, "INVALID_SESSION_STATE");
  assert.equal(action.state, "PAUSED");
});
test("active time and pause time remain separate", () => {
  const paused = pauseFocusTimer(base({ activeSeconds: 600, lastCheckpointAt: "2025-01-01T00:10:00Z" }), "2025-01-01T00:10:00Z");
  const resumed = resumeFocusTimer({ ...base(), ...paused, status: "PAUSED" }, "2025-01-01T00:40:00Z");
  assert.equal(resumed.pauseSeconds, 1800);
  assert.equal(buildFocusTimerSnapshot({ session: { ...base(), ...resumed, status: "ACTIVE" }, now: "2025-01-01T00:40:00Z" }).remainingSeconds, 2100);
});
test("pause reports ready when elapsed reaches target", () => {
  assert.equal(pauseFocusTimer(base(), "2025-01-01T00:45:00Z").status, "SESSION_READY_TO_COMPLETE");
});
test("completion tolerance and cap", () => {
  const tooEarly = completeFocusTimer(
    base({ activeSeconds: 2697, lastCheckpointAt: "2025-01-01T00:44:57Z" }),
    "2025-01-01T00:44:57Z",
  );
  assert.equal(tooEarly.status, "SESSION_NOT_READY");
  const near = completeFocusTimer(
    base({ activeSeconds: 2699, lastCheckpointAt: "2025-01-01T00:44:59Z" }),
    "2025-01-01T00:44:59Z",
  );
  assert.equal(near.state, "COMPLETED");
  assert.equal(near.activeSeconds, 2699);
  assert.equal(
    completeFocusTimer(base(), "2025-01-01T02:00:00Z").activeSeconds,
    2700,
  );
  assert.equal(FOCUS_TIMER_COMPLETION_TOLERANCE_SECONDS, 2);
});
test("abandon records actual active time", () => assert.equal(abandonFocusTimer(base(), "2025-01-01T00:05:00Z").activeSeconds, 300));
test("bad and stale sessions reconcile", () => {
  assert.equal(buildFocusTimerSnapshot({ session: base({ startedAt: "nope" }), now: "2025-01-01T00:01:00Z" }).status, "RECONCILIATION_REQUIRED");
  assert.equal(buildFocusTimerSnapshot({ session: base(), now: "2025-01-03T01:00:00Z" }).status, "RECONCILIATION_REQUIRED");
  assert.equal(buildFocusTimerSnapshot({ session: base({ plannedEndAt: "2024-12-31T23:00:00Z" }), now: "2025-01-01T00:01:00Z" }).status, "RECONCILIATION_REQUIRED");
});
test("negative and fractional counters never fabricate time", () => {
  for (const activeSeconds of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(buildFocusTimerSnapshot({ session: base({ activeSeconds }), now: "2025-01-01T00:01:00Z" }).status, "RECONCILIATION_REQUIRED");
  }
});