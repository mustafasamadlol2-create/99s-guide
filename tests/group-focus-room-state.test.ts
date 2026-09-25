import assert from "node:assert/strict";
import test from "node:test";
import {
  GROUP_FOCUS_CAPABILITY_AUDIENCE,
  GROUP_FOCUS_CAPABILITY_ISSUER,
  GROUP_FOCUS_CAPABILITY_PURPOSE,
  GROUP_FOCUS_CAPABILITY_VERSION,
  type VerifiedGroupFocusCapability,
} from "../shared/group-focus-capability/contract.js";
import {
  advanceGroupFocusRoomState,
  createInitialGroupFocusRoomState,
  groupFocusRoomConfigurationMatches,
  pauseGroupFocusRoom,
  resumeGroupFocusRoom,
  startGroupFocusCountdown,
} from "../cloudflare-group-focus-worker/src/roomState.js";

const roomId = "00000000-0000-4000-8000-000000000010";
const userId = "00000000-0000-4000-8000-000000000011";
const membershipId = "00000000-0000-4000-8000-000000000012";
const lectureId = "00000000-0000-4000-8000-000000000013";

function capability(
  overrides: Partial<VerifiedGroupFocusCapability> = {},
): VerifiedGroupFocusCapability {
  return {
    version: GROUP_FOCUS_CAPABILITY_VERSION,
    userId,
    roomId,
    membershipId,
    role: "HOST",
    mode: "STUDY_TOGETHER",
    visibility: "PUBLIC",
    effectiveLectureId: lectureId,
    focusDurationSeconds: 60,
    breakDurationSeconds: 5,
    roundCount: 2,
    maxParticipants: 4,
    roomUpdatedAt: "2026-09-25T10:00:00.000Z",
    membershipUpdatedAt: "2026-09-25T10:00:00.000Z",
    issuedAt: "2026-09-25T10:00:00.000Z",
    expiresAt: "2026-09-25T10:01:30.000Z",
    jti: "test-jti",
    ...overrides,
  };
}

test("initial room state is a timer-free lobby and host start starts one countdown", () => {
  const initial = createInitialGroupFocusRoomState(capability(), 1_000);
  assert.equal(initial.phase, "LOBBY");
  assert.equal(initial.currentRound, 0);
  assert.equal(initial.phaseEndsAt, null);

  const started = startGroupFocusCountdown(initial, 1_000);
  assert.equal(started?.phase, "COUNTDOWN");
  assert.equal(started?.phaseStartedAt, 1_000);
  assert.equal(started?.phaseEndsAt, 4_000);
  assert.equal(startGroupFocusCountdown(started!, 2_000), null);

  const focused = advanceGroupFocusRoomState(started!, 4_000);
  assert.equal(focused.state.phase, "FOCUS");
  assert.equal(focused.state.currentRound, 1);
  assert.equal(focused.state.phaseStartedAt, 4_000);
  assert.equal(focused.state.phaseEndsAt, 64_000);
});

test("positive breaks and later rounds follow timestamp boundaries", () => {
  const initial = createInitialGroupFocusRoomState(capability(), 0);
  const started = startGroupFocusCountdown(initial, 0)!;
  const focus = advanceGroupFocusRoomState(started, 3_000).state;
  const firstBreak = advanceGroupFocusRoomState(focus, 63_000).state;
  assert.equal(firstBreak.phase, "BREAK");
  assert.equal(firstBreak.currentRound, 1);
  assert.equal(firstBreak.phaseStartedAt, 63_000);
  assert.equal(firstBreak.phaseEndsAt, 68_000);

  const secondCountdown = advanceGroupFocusRoomState(firstBreak, 68_000).state;
  assert.equal(secondCountdown.phase, "COUNTDOWN");
  assert.equal(secondCountdown.currentRound, 1);
  assert.equal(secondCountdown.phaseEndsAt, 71_000);

  const secondFocus = advanceGroupFocusRoomState(secondCountdown, 71_000).state;
  assert.equal(secondFocus.phase, "FOCUS");
  assert.equal(secondFocus.currentRound, 2);
});

test("zero break normalizes directly to the next fixed countdown", () => {
  const initial = createInitialGroupFocusRoomState(
    capability({ breakDurationSeconds: 0 }),
    0,
  );
  const started = startGroupFocusCountdown(initial, 0)!;
  const focus = advanceGroupFocusRoomState(started, 3_000).state;
  const nextCountdown = advanceGroupFocusRoomState(focus, 63_000).state;
  assert.equal(nextCountdown.phase, "COUNTDOWN");
  assert.equal(nextCountdown.currentRound, 1);
  assert.equal(nextCountdown.phaseStartedAt, 63_000);
  assert.equal(nextCountdown.phaseEndsAt, 66_000);
});

test("late alarms catch up from scheduled boundaries without timer drift", () => {
  const initial = createInitialGroupFocusRoomState(capability(), 0);
  const started = startGroupFocusCountdown(initial, 0)!;
  const caughtUp = advanceGroupFocusRoomState(started, 100_000);
  assert.equal(caughtUp.state.phase, "FOCUS");
  assert.equal(caughtUp.state.currentRound, 2);
  assert.equal(caughtUp.state.phaseStartedAt, 71_000);
  assert.equal(caughtUp.state.phaseEndsAt, 131_000);
  assert.equal(caughtUp.transitions.length, 4);
  assert.deepEqual(
    caughtUp.transitions.map((state) => state.phase),
    ["FOCUS", "BREAK", "COUNTDOWN", "FOCUS"],
  );

  const completed = advanceGroupFocusRoomState(caughtUp.state, 200_000).state;
  assert.equal(completed.phase, "COMPLETED");
  assert.equal(completed.currentRound, 2);
  assert.equal(completed.phaseEndsAt, null);
});

test("pause preserves the round and resume restores the remaining time", () => {
  const initial = createInitialGroupFocusRoomState(capability(), 0);
  const countdown = startGroupFocusCountdown(initial, 0)!;
  const focus = advanceGroupFocusRoomState(countdown, 3_000).state;
  const paused = pauseGroupFocusRoom(focus, 15_000);
  assert.equal(paused?.phase, "PAUSED");
  assert.equal(paused?.currentRound, 1);
  assert.equal(paused?.pausedFromPhase, "FOCUS");
  assert.equal(paused?.pausedRemainingMilliseconds, 48_000);

  const resumed = resumeGroupFocusRoom(paused!, 30_000);
  assert.equal(resumed?.phase, "FOCUS");
  assert.equal(resumed?.phaseStartedAt, 30_000);
  assert.equal(resumed?.phaseEndsAt, 78_000);
  assert.equal(resumed?.pausedFromPhase, null);
});

test("zero remainder resumes through the same due-transition function", () => {
  const initial = createInitialGroupFocusRoomState(capability(), 0);
  const countdown = startGroupFocusCountdown(initial, 0)!;
  const paused = pauseGroupFocusRoom(countdown, 3_000)!;
  assert.equal(paused.pausedRemainingMilliseconds, 0);

  const resumed = resumeGroupFocusRoom(paused, 10_000)!;
  const normalized = advanceGroupFocusRoomState(resumed, 10_000);
  assert.equal(normalized.state.phase, "FOCUS");
  assert.equal(normalized.state.currentRound, 1);
  assert.equal(normalized.state.phaseStartedAt, 10_000);
});

test("runtime configuration matching ignores timestamps but rejects changed room settings", () => {
  const state = createInitialGroupFocusRoomState(capability(), 1_000);
  assert.equal(
    groupFocusRoomConfigurationMatches(
      state,
      capability({ roomUpdatedAt: "2026-09-25T10:00:30.000Z" }),
    ),
    true,
  );
  assert.equal(
    groupFocusRoomConfigurationMatches(
      state,
      capability({ focusDurationSeconds: 120 }),
    ),
    false,
  );
  assert.equal(
    groupFocusRoomConfigurationMatches(
      state,
      capability({ mode: "SHARED_LECTURE" }),
    ),
    false,
  );
  assert.equal(
    groupFocusRoomConfigurationMatches(
      state,
      capability({ visibility: "PRIVATE" }),
    ),
    false,
  );
});

test("capability constants used by runtime construction stay aligned", () => {
  assert.equal(GROUP_FOCUS_CAPABILITY_ISSUER, "99s-guide-api");
  assert.equal(GROUP_FOCUS_CAPABILITY_AUDIENCE, "99s-guide-group-focus-worker");
  assert.equal(GROUP_FOCUS_CAPABILITY_PURPOSE, "group_focus_room_access");
});