import assert from "node:assert/strict";
import test from "node:test";
import {
  GROUP_FOCUS_REALTIME_MAX_MESSAGE_BYTES,
  parseGroupFocusRealtimeClientMessage,
  parseGroupFocusRealtimeServerMessage,
} from "../shared/group-focus-realtime/protocol.js";

test("Group Focus realtime protocol accepts only the frozen client controls", () => {
  assert.deepEqual(
    parseGroupFocusRealtimeClientMessage('{"v":1,"type":"ROOM_STATE_REQUEST"}'),
    { v: 1, type: "ROOM_STATE_REQUEST" },
  );
  assert.deepEqual(
    parseGroupFocusRealtimeClientMessage('{"v":1,"type":"HOST_PAUSE"}'),
    { v: 1, type: "HOST_PAUSE" },
  );
  assert.equal(
    parseGroupFocusRealtimeClientMessage('{"v":1,"type":"CHAT_SEND"}'),
    null,
  );
  assert.equal(
    parseGroupFocusRealtimeClientMessage('{"v":1,"type":"HOST_START","role":"HOST"}'),
    null,
  );
  assert.equal(
    parseGroupFocusRealtimeClientMessage('{"v":2,"type":"HOST_START"}'),
    null,
  );
  assert.equal(
    parseGroupFocusRealtimeClientMessage("x".repeat(GROUP_FOCUS_REALTIME_MAX_MESSAGE_BYTES + 1)),
    null,
  );
});

test("presence wire messages expose only the approved participant fields", () => {
  const safe = {
    v: 1,
    type: "PRESENCE_SNAPSHOT",
    revision: 2,
    serverNow: 1000,
    payload: {
      sequence: 2,
      participants: [{
        userId: "00000000-0000-4000-8000-000000000001",
        role: "HOST",
        effectiveLectureId: "00000000-0000-4000-8000-000000000002",
        connectedAt: 900,
      }],
    },
  };
  assert.deepEqual(
    parseGroupFocusRealtimeServerMessage(JSON.stringify(safe)),
    safe,
  );

  const privateParticipant = {
    ...safe,
    payload: {
      ...safe.payload,
      participants: [{
        ...safe.payload.participants[0],
        membershipId: "00000000-0000-4000-8000-000000000003",
      }],
    },
  };
  assert.equal(
    parseGroupFocusRealtimeServerMessage(JSON.stringify(privateParticipant)),
    null,
  );
});

test("server protocol rejects malformed room-state envelopes", () => {
  const invalid = {
    v: 1,
    type: "ROOM_STATE",
    revision: 4,
    serverNow: 2000,
    payload: {
      roomState: {
        mode: "STUDY_TOGETHER",
        phase: "FOCUS",
        currentRound: 1,
        roundCount: 2,
        focusDurationSeconds: 60,
        breakDurationSeconds: 0,
        maxParticipants: 4,
        phaseStartedAt: 1000,
        phaseEndsAt: 61000,
        pausedFromPhase: null,
        pausedRemainingMilliseconds: null,
        unexpected: true,
      },
    },
  };
  assert.equal(parseGroupFocusRealtimeServerMessage(JSON.stringify(invalid)), null);
});