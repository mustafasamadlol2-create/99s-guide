import assert from "node:assert/strict";
import test from "node:test";
import {
  applyScheduledTransitions,
  closeVerifiedFocusSegment,
  createFrozenSummary,
  createGroupFocusRuntimeData,
  isValidGroupFocusRuntimeData,
  startParticipantFocusSegment,
  type GroupFocusRuntimeParticipant,
} from "../cloudflare-group-focus-worker/src/runtimeState.js";
import type { GroupFocusRoomState } from "../cloudflare-group-focus-worker/src/roomState.js";

const roomId = "00000000-0000-4000-8000-000000000020";
const userId = "00000000-0000-4000-8000-000000000021";
const membershipId = "00000000-0000-4000-8000-000000000022";
const lectureId = "00000000-0000-4000-8000-000000000023";

function makeRoomState(
  overrides: Partial<GroupFocusRoomState> = {},
): GroupFocusRoomState {
  return {
    stateVersion: 1,
    roomId,
    mode: "STUDY_TOGETHER",
    visibility: "PUBLIC",
    focusDurationSeconds: 25,
    breakDurationSeconds: 5,
    roundCount: 1,
    maxParticipants: 4,
    phase: "FOCUS",
    currentRound: 1,
    connections: [],
    phaseStartedAt: 1_000,
    phaseEndsAt: 26_000,
    pausedFromPhase: null,
    pausedRemainingMilliseconds: null,
    revision: 1,
    createdAt: 0,
    updatedAt: 1_000,
    ...overrides,
  };
}

function makeParticipant(): GroupFocusRuntimeParticipant {
  return {
    userId,
    membershipId,
    role: "MEMBER",
    effectiveLectureId: lectureId,
    connectionState: "CONNECTED",
    connectionId: "connection-1",
    firstConnectedAt: 1_000,
    lastConnectedAt: 1_000,
    lastDisconnectedAt: null,
    reconnectCount: 0,
    resumeTokenHash: null,
    resumeTokenExpiresAt: null,
    reconnectDeadlineAt: null,
    totalVerifiedFocusMilliseconds: 0,
    perRoundVerifiedFocusMilliseconds: [0],
    activeFocusSegmentStartedAt: 1_000,
  };
}

test("verified focus excludes reconnect gaps and caps late close at the phase boundary", () => {
  const runtime = createGroupFocusRuntimeData(roomId, 0);
  const participant = makeParticipant();
  runtime.participants.push(participant);
  const state = makeRoomState();

  closeVerifiedFocusSegment(runtime, state, participant, 5_000);
  participant.connectionState = "RECONNECTING";
  participant.connectionId = null;
  assert.equal(participant.totalVerifiedFocusMilliseconds, 4_000);
  assert.equal(participant.activeFocusSegmentStartedAt, null);

  participant.connectionState = "CONNECTED";
  participant.connectionId = "connection-2";
  participant.lastConnectedAt = 7_000;
  startParticipantFocusSegment(runtime, state, participant, 7_000);
  closeVerifiedFocusSegment(runtime, state, participant, 30_000);

  assert.equal(participant.totalVerifiedFocusMilliseconds, 23_000);
  assert.deepEqual(participant.perRoundVerifiedFocusMilliseconds, [23_000]);

  const breakState = makeRoomState({
    phase: "BREAK",
    phaseStartedAt: 26_000,
    phaseEndsAt: 31_000,
  });
  participant.activeFocusSegmentStartedAt = 30_000;
  closeVerifiedFocusSegment(runtime, breakState, participant, 31_000);
  assert.equal(participant.totalVerifiedFocusMilliseconds, 23_000);
});

test("scheduled focus transitions use exact boundaries and never credit break time", () => {
  const runtime = createGroupFocusRuntimeData(roomId, 0);
  const participant = makeParticipant();
  runtime.participants.push(participant);
  const focus = makeRoomState();
  const breakPhase = makeRoomState({
    phase: "BREAK",
    phaseStartedAt: 26_000,
    phaseEndsAt: 31_000,
    revision: 2,
    updatedAt: 26_000,
  });

  applyScheduledTransitions(runtime, focus, [breakPhase]);
  assert.equal(participant.totalVerifiedFocusMilliseconds, 25_000);
  assert.equal(participant.activeFocusSegmentStartedAt, null);

  const nextFocus = makeRoomState({
    phaseStartedAt: 36_000,
    phaseEndsAt: 61_000,
    revision: 4,
    updatedAt: 36_000,
  });
  applyScheduledTransitions(runtime, breakPhase, [nextFocus]);
  assert.equal(participant.activeFocusSegmentStartedAt, 36_000);
  assert.equal(participant.totalVerifiedFocusMilliseconds, 25_000);
});

test("frozen terminal summaries have a restart-valid hex body hash", async () => {
  const runtime = createGroupFocusRuntimeData(roomId, 0);
  const participant = makeParticipant();
  participant.totalVerifiedFocusMilliseconds = 23_000;
  participant.perRoundVerifiedFocusMilliseconds = [23_000];
  participant.activeFocusSegmentStartedAt = null;
  participant.lastDisconnectedAt = 26_000;
  runtime.participants.push(participant);
  const terminalState = makeRoomState({
    phase: "COMPLETED",
    phaseStartedAt: 26_000,
    phaseEndsAt: null,
    revision: 5,
    updatedAt: 26_000,
  });
  const body = createFrozenSummary(runtime, terminalState, "COMPLETED", 26_000);
  assert.equal(body.participants[0]?.verifiedFocusSeconds, 23);
  assert.equal(body.participants[0]?.rounds[0]?.verifiedFocusSeconds, 23);

  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const bodyHash = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0")).join("");
  runtime.summary = {
    body,
    bodyHash,
    status: "PENDING",
    attempts: 0,
    nextAttemptAt: 30_000,
    acknowledgedAt: null,
    retentionUntil: null,
  };

  assert.equal(bodyHash.length, 64);
  assert.equal(isValidGroupFocusRuntimeData(runtime), true);
});