import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGroupFocusParticipantStudyEvents,
} from "../server/features/group-focus/runtimeSummary.js";
import type {
  GroupFocusRuntimeSummary,
  GroupFocusRuntimeSummaryParticipant,
} from "../shared/group-focus-reconciliation/contract.js";

const roomId = "00000000-0000-4000-8000-000000000020";
const runId = "00000000-0000-4000-8000-000000000021";
const userId = "00000000-0000-4000-8000-000000000022";
const membershipId = "00000000-0000-4000-8000-000000000023";
const lectureId = "00000000-0000-4000-8000-000000000024";

function makeSummary(): GroupFocusRuntimeSummary {
  return {
    summaryVersion: 1,
    summaryId: "abcdefghijklmnopqrstuv",
    runtimeInstanceId: "zyxwvutsrqponmlkjihgfe",
    roomId,
    mode: "SHARED_LECTURE",
    focusDurationSeconds: 1_500,
    breakDurationSeconds: 300,
    roundCount: 2,
    runtimeStartedAt: "2026-09-25T12:00:00.000Z",
    runtimeEndedAt: "2026-09-25T13:00:00.000Z",
    terminalReason: "COMPLETED",
    completedRounds: 1,
    finalRevision: 12,
    participants: [],
  };
}

function makeParticipant(
  overrides: Partial<GroupFocusRuntimeSummaryParticipant> = {},
): GroupFocusRuntimeSummaryParticipant {
  return {
    userId,
    membershipId,
    role: "MEMBER",
    effectiveLectureId: lectureId,
    firstConnectedAt: "2026-09-25T12:00:03.000Z",
    lastDisconnectedAt: "2026-09-25T12:59:59.000Z",
    reconnectCount: 1,
    verifiedFocusSeconds: 2_995,
    rounds: [
      { roundNumber: 1, verifiedFocusSeconds: 1_498 },
      { roundNumber: 2, verifiedFocusSeconds: 1_497 },
    ],
    ...overrides,
  };
}

test("one verified participant produces four bounded events and the 2-second round threshold", () => {
  const summary = makeSummary();
  const participant = makeParticipant();
  const events = buildGroupFocusParticipantStudyEvents(summary, runId, participant);

  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      "group_focus_joined",
      "group_focus_round_completed",
      "group_focus_left",
      "group_focus_summary_completed",
    ],
  );
  const roundPayload = events[1]?.payload as { roundNumber: number } | undefined;
  const summaryPayload = events[3]?.payload as { roundsCompleted: number } | undefined;
  assert.equal(events[0]?.occurredAt, participant.firstConnectedAt);
  assert.equal(events[1]?.occurredAt, participant.lastDisconnectedAt);
  assert.equal(events[2]?.occurredAt, participant.lastDisconnectedAt);
  assert.equal(events[3]?.occurredAt, summary.runtimeEndedAt);
  assert.equal(roundPayload?.roundNumber, 1);
  assert.equal(summaryPayload?.roundsCompleted, 1);
  assert.equal(events[0]?.source, "backend");
  assert.equal(events[0]?.evidenceClass, "REALTIME_VERIFIED");
  assert.equal(events[0]?.privacyClass, "PRIVATE_STUDY");
});

test("zero verified focus retains presence history but emits no completion event", () => {
  const participant = makeParticipant({
    verifiedFocusSeconds: 0,
    rounds: [{ roundNumber: 1, verifiedFocusSeconds: 0 }],
  });
  const events = buildGroupFocusParticipantStudyEvents(
    {
      ...makeSummary(),
      terminalReason: "LOBBY_IDLE_TIMEOUT",
      completedRounds: 0,
    },
    runId,
    participant,
  );

  assert.deepEqual(
    events.map((event) => event.eventType),
    ["group_focus_joined", "group_focus_left"],
  );
});