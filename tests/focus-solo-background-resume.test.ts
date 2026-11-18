import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FocusSessionDto } from "../server/features/focus/types.js";
import type { FocusApi } from "../src/features/focus/api/focusApi.js";
import { FocusRuntimeController } from "../src/features/focus/runtime/controller.js";
import { confirmedCurrentFocusSession } from "../src/features/focus/runtime/currentSession.js";
import { isServerCountedFocusStatus } from "../src/features/focus/runtime/timer.js";

const id = "11111111-1111-4111-8111-111111111111";
const at = "2026-11-18T10:00:00.000Z";
function session(status: FocusSessionDto["status"]): FocusSessionDto {
  return {
    id, planId: id, planItemId: id, lectureId: id, status,
    startedAt: at, plannedEndAt: "2026-11-18T10:25:00.000Z",
    actualEndedAt: status === "ABANDONED" ? at : null,
    lastCheckpointAt: at, activeSeconds: 0, pauseSeconds: 0,
    serverNow: at, elapsedActiveSeconds: 0, remainingSeconds: 1500,
    completionEligible: false, sessionNumber: 1, plannedSessionCount: 1,
    isLastPlannedSession: true, reconciliationRequired: false, completionReason: null,
  };
}

test("resource handoff keeps a live display tick; PAUSED and terminal sessions do not", async () => {
  let time = 0;
  let timerId = 0;
  const timers = new Map<number, () => void>();
  const makeTimer = (cb: () => void) => {
    const token = ++timerId;
    timers.set(token, () => { timers.delete(token); cb(); });
    return token as unknown as ReturnType<typeof setTimeout>;
  };
  const controller = new FocusRuntimeController({
    api: { getCurrentFocusSession: async () => ({ session: session("RESOURCE_HANDOFF"), serverNow: at }) } as FocusApi,
    cache: null,
    lifecycle: null,
    clock: { monotonicNow: () => time },
    setTimer: makeTimer,
    clearTimer: (token) => timers.delete(token as unknown as number),
  });
  await controller.initialize();
  const unsubscribe = controller.subscribe(() => {});
  assert.equal(timers.size, 1, "handoff should continue ticking visibly without Return to Focus");
  time += 3000;
  const tick = [...timers.values()][0];
  tick();
  assert.equal(controller.getState().displayRemainingSeconds, 1497);
  assert.equal(timers.size, 1, "handoff should schedule the next tick");
  controller.acceptMutationSession(session("PAUSED"));
  assert.equal(timers.size, 0, "only explicit pause freezes the timer");
  controller.acceptMutationSession(session("ABANDONED"));
  assert.equal(controller.getState().session, null);
  assert.equal(timers.size, 0, "End should cancel the display tick");
  unsubscribe();
  controller.dispose();
});

test("Resume is only offered for a canonical, nonterminal session", () => {
  assert.equal(confirmedCurrentFocusSession({ session: session("ACTIVE"), sessionAuthority: "NON_AUTHORITATIVE" }), null);
  assert.equal(confirmedCurrentFocusSession({ session: session("ABANDONED"), sessionAuthority: "CANONICAL" }), null);
  assert.equal(confirmedCurrentFocusSession({ session: session("COMPLETED"), sessionAuthority: "CANONICAL" }), null);
  assert.equal(confirmedCurrentFocusSession({ session: null, sessionAuthority: "CANONICAL" }), null);
  assert.equal(confirmedCurrentFocusSession({ session: session("RESOURCE_HANDOFF"), sessionAuthority: "CANONICAL" })?.id, id);
});

test("Focus screen no longer gates background study on the Return to Focus banner", () => {
  const active = readFileSync(resolve("src/features/focus/components/ActiveFocusScreen.tsx"), "utf8");
  const hub = readFileSync(resolve("src/features/focus/components/FocusHub.tsx"), "utf8");
  assert.equal(active.includes("{t.focusActiveReturnToFocus}"), false);
  assert.equal(active.includes("{isResourceHandoff && ("), false);
  assert.match(active, /handoffAutoReturnAttemptRef/);
  assert.match(hub, /confirmedCurrentFocusSession\(runtimeState\)/);
  assert.equal(hub.includes("setCurrentSession("), false);
});
