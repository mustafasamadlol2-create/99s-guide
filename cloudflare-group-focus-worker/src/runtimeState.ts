import {
  GROUP_FOCUS_RECONNECT_GRACE_SECONDS,
  GROUP_FOCUS_RESUME_TOKEN_TTL_SECONDS,
  GROUP_FOCUS_CANONICAL_RECONCILIATION_INTERVAL_SECONDS,
  GROUP_FOCUS_SUMMARY_VERSION,
  type GroupFocusRuntimeSummary,
  type GroupFocusRuntimeSummaryParticipant,
  type GroupFocusSummaryTerminalReason,
} from "../../shared/group-focus-reconciliation/contract.js";
import type { VerifiedGroupFocusCapability } from "../../shared/group-focus-capability/contract.js";
import type {
  GroupFocusRealtimeConnectionState,
  GroupFocusRealtimeSocketAttachment,
} from "../../shared/group-focus-realtime/protocol.js";
import type { GroupFocusRoomState } from "./roomState.js";

export const GROUP_FOCUS_RUNTIME_RECORD_VERSION = 1 as const;
export const GROUP_FOCUS_RECONNECT_GRACE_MILLISECONDS =
  GROUP_FOCUS_RECONNECT_GRACE_SECONDS * 1000;
export const GROUP_FOCUS_RESUME_TOKEN_TTL_MILLISECONDS =
  GROUP_FOCUS_RESUME_TOKEN_TTL_SECONDS * 1000;
export const GROUP_FOCUS_CANONICAL_FAILURE_LIMIT_MILLISECONDS = 5 * 60 * 1000;
export const GROUP_FOCUS_HOST_CONTROL_FRESHNESS_MILLISECONDS = 15 * 1000;
export const GROUP_FOCUS_SUMMARY_RETRY_DELAYS_MILLISECONDS = [
  5_000,
  15_000,
  30_000,
  60_000,
  120_000,
  300_000,
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type GroupFocusRuntimeParticipant = {
  userId: string;
  membershipId: string;
  role: "HOST" | "MEMBER";
  effectiveLectureId: string;
  connectionState: GroupFocusRealtimeConnectionState | "DISCONNECTED" | "CANONICALLY_INVALIDATED";
  connectionId: string | null;
  firstConnectedAt: number;
  lastConnectedAt: number;
  lastDisconnectedAt: number | null;
  reconnectCount: number;
  resumeTokenHash: string | null;
  resumeTokenExpiresAt: number | null;
  reconnectDeadlineAt: number | null;
  totalVerifiedFocusMilliseconds: number;
  perRoundVerifiedFocusMilliseconds: number[];
  activeFocusSegmentStartedAt: number | null;
};

export type GroupFocusFrozenSummary = {
  body: GroupFocusRuntimeSummary;
  bodyHash: string;
  status: "PENDING" | "ACKED" | "FAILED_CONFLICT" | "FAILED_PERMANENT";
  attempts: number;
  nextAttemptAt: number | null;
  acknowledgedAt: number | null;
  retentionUntil: number | null;
};

export type GroupFocusRuntimeData = {
  runtimeVersion: typeof GROUP_FOCUS_RUNTIME_RECORD_VERSION;
  roomId: string;
  runtimeInstanceId: string;
  summaryId: string;
  runtimeStartedAt: number;
  participants: GroupFocusRuntimeParticipant[];
  lastCanonicalSyncAt: number;
  lastCanonicalSyncFailureAt: number | null;
  canonicalSyncFailureCount: number;
  nextCanonicalSyncAt: number;
  canonicalReconciliationRequired: boolean;
  reconciliationError: string | null;
  idleSinceAt: number | null;
  terminalReason: GroupFocusSummaryTerminalReason | null;
  terminalAt: number | null;
  summary: GroupFocusFrozenSummary | null;
};

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSummaryParticipant(value: unknown): value is GroupFocusRuntimeSummaryParticipant {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const participant = value as Record<string, unknown>;
  return typeof participant.userId === "string"
    && typeof participant.membershipId === "string"
    && (participant.role === "HOST" || participant.role === "MEMBER")
    && typeof participant.effectiveLectureId === "string"
    && typeof participant.firstConnectedAt === "string"
    && Number.isFinite(Date.parse(participant.firstConnectedAt))
    && typeof participant.lastDisconnectedAt === "string"
    && Number.isFinite(Date.parse(participant.lastDisconnectedAt))
    && isSafeInteger(participant.reconnectCount)
    && isSafeInteger(participant.verifiedFocusSeconds)
    && Array.isArray(participant.rounds)
    && participant.rounds.length <= 20
    && participant.rounds.every((round) => {
      if (typeof round !== "object" || round === null || Array.isArray(round)) return false;
      const item = round as Record<string, unknown>;
      return isSafeInteger(item.roundNumber)
        && item.roundNumber >= 1
        && isSafeInteger(item.verifiedFocusSeconds);
    });
}

function isRuntimeSummary(value: unknown): value is GroupFocusRuntimeSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const summary = value as Record<string, unknown>;
  return summary.summaryVersion === GROUP_FOCUS_SUMMARY_VERSION
    && typeof summary.summaryId === "string"
    && typeof summary.runtimeInstanceId === "string"
    && typeof summary.roomId === "string"
    && (summary.mode === "SHARED_LECTURE" || summary.mode === "STUDY_TOGETHER")
    && isSafeInteger(summary.focusDurationSeconds)
    && isSafeInteger(summary.breakDurationSeconds)
    && isSafeInteger(summary.roundCount)
    && typeof summary.runtimeStartedAt === "string"
    && Number.isFinite(Date.parse(summary.runtimeStartedAt))
    && typeof summary.runtimeEndedAt === "string"
    && Number.isFinite(Date.parse(summary.runtimeEndedAt))
    && ["COMPLETED", "HOST_CLOSED", "CANONICAL_ROOM_CLOSED",
      "LOBBY_IDLE_TIMEOUT", "PAUSED_IDLE_TIMEOUT"].includes(String(summary.terminalReason))
    && isSafeInteger(summary.completedRounds)
    && isSafeInteger(summary.finalRevision)
    && Array.isArray(summary.participants)
    && summary.participants.length <= 25
    && summary.participants.every(isSummaryParticipant);
}

function isFrozenSummary(value: unknown): value is GroupFocusFrozenSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const summary = value as Record<string, unknown>;
  return isRuntimeSummary(summary.body)
    && typeof summary.bodyHash === "string"
    && /^[a-f0-9]{64}$/u.test(summary.bodyHash)
    && ["PENDING", "ACKED", "FAILED_CONFLICT", "FAILED_PERMANENT"]
      .includes(String(summary.status))
    && isSafeInteger(summary.attempts)
    && (summary.nextAttemptAt === null || isSafeInteger(summary.nextAttemptAt))
    && (summary.acknowledgedAt === null || isSafeInteger(summary.acknowledgedAt))
    && (summary.retentionUntil === null || isSafeInteger(summary.retentionUntil));
}

export function isValidGroupFocusRuntimeData(value: unknown): value is GroupFocusRuntimeData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  const expected = [
    "runtimeVersion",
    "roomId",
    "runtimeInstanceId",
    "summaryId",
    "runtimeStartedAt",
    "participants",
    "lastCanonicalSyncAt",
    "lastCanonicalSyncFailureAt",
    "canonicalSyncFailureCount",
    "nextCanonicalSyncAt",
    "canonicalReconciliationRequired",
    "reconciliationError",
    "idleSinceAt",
    "terminalReason",
    "terminalAt",
    "summary",
  ].sort();
  const actual = Object.keys(data).sort();
  const integer = isSafeInteger;
  if (
    actual.length !== expected.length
    || !actual.every((key, index) => key === expected[index])
    || data.runtimeVersion !== GROUP_FOCUS_RUNTIME_RECORD_VERSION
    || typeof data.roomId !== "string"
    || !UUID.test(data.roomId)
    || typeof data.runtimeInstanceId !== "string"
    || typeof data.summaryId !== "string"
    || !integer(data.runtimeStartedAt)
    || !integer(data.lastCanonicalSyncAt)
    || !(data.lastCanonicalSyncFailureAt === null || integer(data.lastCanonicalSyncFailureAt))
    || !integer(data.canonicalSyncFailureCount)
    || !integer(data.nextCanonicalSyncAt)
    || typeof data.canonicalReconciliationRequired !== "boolean"
    || !(data.reconciliationError === null || typeof data.reconciliationError === "string")
    || !(data.idleSinceAt === null || integer(data.idleSinceAt))
    || !(data.terminalReason === null
      || ["COMPLETED", "HOST_CLOSED", "CANONICAL_ROOM_CLOSED",
        "LOBBY_IDLE_TIMEOUT", "PAUSED_IDLE_TIMEOUT"].includes(String(data.terminalReason)))
    || !(data.terminalAt === null || integer(data.terminalAt))
    || !(data.summary === null || (
      isFrozenSummary(data.summary)
      && data.summary.body.summaryId === data.summaryId
      && data.summary.body.runtimeInstanceId === data.runtimeInstanceId
      && data.summary.body.roomId === data.roomId
    ))
    || !Array.isArray(data.participants)
    || data.participants.length > 25
  ) return false;
  return data.participants.every((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
    const participant = item as Record<string, unknown>;
    return typeof participant.userId === "string"
      && typeof participant.membershipId === "string"
      && (participant.role === "HOST" || participant.role === "MEMBER")
      && typeof participant.effectiveLectureId === "string"
      && ["CONNECTED", "RECONNECTING", "DISCONNECTED", "CANONICALLY_INVALIDATED"]
        .includes(String(participant.connectionState))
      && (participant.connectionId === null || typeof participant.connectionId === "string")
      && integer(participant.firstConnectedAt)
      && integer(participant.lastConnectedAt)
      && (participant.lastDisconnectedAt === null || integer(participant.lastDisconnectedAt))
      && integer(participant.reconnectCount)
      && (participant.resumeTokenHash === null || typeof participant.resumeTokenHash === "string")
      && (participant.resumeTokenExpiresAt === null || integer(participant.resumeTokenExpiresAt))
      && (participant.reconnectDeadlineAt === null || integer(participant.reconnectDeadlineAt))
      && integer(participant.totalVerifiedFocusMilliseconds)
      && Array.isArray(participant.perRoundVerifiedFocusMilliseconds)
      && participant.perRoundVerifiedFocusMilliseconds.length <= 20
      && participant.perRoundVerifiedFocusMilliseconds.every(integer)
      && (participant.activeFocusSegmentStartedAt === null
        || integer(participant.activeFocusSegmentStartedAt));
  });
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

export async function hashResumeToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createGroupFocusRuntimeData(roomId: string, now: number): GroupFocusRuntimeData {
  return {
    runtimeVersion: GROUP_FOCUS_RUNTIME_RECORD_VERSION,
    roomId,
    runtimeInstanceId: randomToken(16),
    summaryId: randomToken(16),
    runtimeStartedAt: now,
    participants: [],
    lastCanonicalSyncAt: now,
    lastCanonicalSyncFailureAt: null,
    canonicalSyncFailureCount: 0,
    nextCanonicalSyncAt: now + GROUP_FOCUS_CANONICAL_RECONCILIATION_INTERVAL_SECONDS * 1000,
    canonicalReconciliationRequired: false,
    reconciliationError: null,
    idleSinceAt: now,
    terminalReason: null,
    terminalAt: null,
    summary: null,
  };
}

export function createRuntimeParticipant(
  capability: VerifiedGroupFocusCapability,
  attachment: GroupFocusRealtimeSocketAttachment,
  resumeTokenHash: string,
  now: number,
  roundCount: number,
  reconnectCount = 0,
): GroupFocusRuntimeParticipant {
  return {
    userId: capability.userId,
    membershipId: capability.membershipId,
    role: capability.role,
    effectiveLectureId: capability.effectiveLectureId,
    connectionState: "CONNECTED",
    connectionId: attachment.connectionId,
    firstConnectedAt: now,
    lastConnectedAt: now,
    lastDisconnectedAt: null,
    reconnectCount,
    resumeTokenHash,
    resumeTokenExpiresAt: now + GROUP_FOCUS_RESUME_TOKEN_TTL_MILLISECONDS,
    reconnectDeadlineAt: null,
    totalVerifiedFocusMilliseconds: 0,
    perRoundVerifiedFocusMilliseconds: Array.from({ length: roundCount }, () => 0),
    activeFocusSegmentStartedAt: null,
  };
}

export function closeVerifiedFocusSegment(
  runtime: GroupFocusRuntimeData,
  state: GroupFocusRoomState,
  participant: GroupFocusRuntimeParticipant,
  requestedEndAt: number,
): void {
  const start = participant.activeFocusSegmentStartedAt;
  if (start === null) return;
  participant.activeFocusSegmentStartedAt = null;
  if (
    state.phase !== "FOCUS"
    || state.currentRound < 1
    || state.currentRound > state.roundCount
  ) return;
  const endAt = Math.min(
    requestedEndAt,
    state.phaseEndsAt ?? requestedEndAt,
  );
  const elapsed = Math.max(0, endAt - start);
  const roundIndex = state.currentRound - 1;
  const roundCap = state.focusDurationSeconds * 1000;
  const before = participant.perRoundVerifiedFocusMilliseconds[roundIndex] ?? 0;
  const credited = Math.min(roundCap, before + elapsed) - before;
  participant.perRoundVerifiedFocusMilliseconds[roundIndex] = before + credited;
  participant.totalVerifiedFocusMilliseconds = Math.min(
    state.roundCount * roundCap,
    participant.totalVerifiedFocusMilliseconds + credited,
  );
}

export function applyScheduledTransitions(
  runtime: GroupFocusRuntimeData,
  initial: GroupFocusRoomState,
  transitions: readonly GroupFocusRoomState[],
): void {
  let previous = initial;
  for (const current of transitions) {
    if (previous.phase === "FOCUS") {
      const boundary = previous.phaseEndsAt ?? current.phaseStartedAt ?? current.updatedAt;
      for (const participant of runtime.participants) {
        if (participant.connectionState === "CONNECTED") {
          closeVerifiedFocusSegment(runtime, previous, participant, boundary);
        }
      }
    }
    if (current.phase === "FOCUS") {
      const boundary = current.phaseStartedAt ?? current.updatedAt;
      for (const participant of runtime.participants) {
        if (participant.connectionState === "CONNECTED") {
          participant.activeFocusSegmentStartedAt = boundary;
        }
      }
    }
    previous = current;
  }
}

export function startParticipantFocusSegment(
  runtime: GroupFocusRuntimeData,
  state: GroupFocusRoomState,
  participant: GroupFocusRuntimeParticipant,
  now: number,
): void {
  if (state.phase === "FOCUS" && participant.connectionState === "CONNECTED") {
    participant.activeFocusSegmentStartedAt = now;
  }
  runtime.idleSinceAt = null;
}

export function stopParticipantConnection(
  runtime: GroupFocusRuntimeData,
  state: GroupFocusRoomState,
  participant: GroupFocusRuntimeParticipant,
  now: number,
  nextState: GroupFocusRuntimeParticipant["connectionState"],
): void {
  closeVerifiedFocusSegment(runtime, state, participant, now);
  participant.connectionState = nextState;
  participant.connectionId = null;
  participant.lastDisconnectedAt = now;
  participant.resumeTokenHash = nextState === "RECONNECTING"
    ? participant.resumeTokenHash
    : null;
  participant.resumeTokenExpiresAt = nextState === "RECONNECTING"
    ? participant.resumeTokenExpiresAt
    : null;
  participant.reconnectDeadlineAt = nextState === "RECONNECTING"
    ? now + GROUP_FOCUS_RECONNECT_GRACE_MILLISECONDS
    : null;
  if (!runtime.participants.some((entry) =>
    entry.connectionState === "CONNECTED" || entry.connectionState === "RECONNECTING")) {
    runtime.idleSinceAt = runtime.idleSinceAt ?? now;
  }
}

export function toRuntimeSummaryParticipant(
  participant: GroupFocusRuntimeParticipant,
  roomState: GroupFocusRoomState,
  runtimeEndedAt: number,
): GroupFocusRuntimeSummaryParticipant {
  const rounds = participant.perRoundVerifiedFocusMilliseconds.map((milliseconds, index) => ({
    roundNumber: index + 1,
    verifiedFocusSeconds: Math.floor(milliseconds / 1000),
  }));
  const verifiedFocusSeconds = Math.min(
    roomState.roundCount * roomState.focusDurationSeconds,
    Math.floor(participant.totalVerifiedFocusMilliseconds / 1000),
  );
  return {
    userId: participant.userId,
    membershipId: participant.membershipId,
    role: participant.role,
    effectiveLectureId: participant.effectiveLectureId,
    firstConnectedAt: new Date(participant.firstConnectedAt).toISOString(),
    lastDisconnectedAt: new Date(
      participant.lastDisconnectedAt ?? runtimeEndedAt,
    ).toISOString(),
    reconnectCount: participant.reconnectCount,
    verifiedFocusSeconds,
    rounds,
  };
}

export function createFrozenSummary(
  runtime: GroupFocusRuntimeData,
  roomState: GroupFocusRoomState,
  terminalReason: GroupFocusSummaryTerminalReason,
  runtimeEndedAt: number,
): GroupFocusRuntimeSummary {
  const completedRounds = roomState.phase === "COMPLETED"
    ? roomState.roundCount
    : roomState.phase === "BREAK"
      || (roomState.phase === "PAUSED" && roomState.pausedFromPhase === "BREAK")
      ? roomState.currentRound
      : roomState.phase === "LOBBY"
        ? 0
        : Math.max(0, roomState.currentRound - 1);
  return {
    summaryVersion: GROUP_FOCUS_SUMMARY_VERSION,
    summaryId: runtime.summaryId,
    runtimeInstanceId: runtime.runtimeInstanceId,
    roomId: roomState.roomId,
    mode: roomState.mode,
    focusDurationSeconds: roomState.focusDurationSeconds,
    breakDurationSeconds: roomState.breakDurationSeconds,
    roundCount: roomState.roundCount,
    runtimeStartedAt: new Date(runtime.runtimeStartedAt).toISOString(),
    runtimeEndedAt: new Date(runtimeEndedAt).toISOString(),
    terminalReason,
    completedRounds: Math.min(roomState.roundCount, completedRounds),
    finalRevision: roomState.revision,
    participants: runtime.participants
      .map((participant) => toRuntimeSummaryParticipant(participant, roomState, runtimeEndedAt))
      .sort((left, right) => left.userId.localeCompare(right.userId)),
  };
}

export function nextRetryDelay(attempt: number): number {
  const index = Math.min(Math.max(0, attempt), GROUP_FOCUS_SUMMARY_RETRY_DELAYS_MILLISECONDS.length - 1);
  return GROUP_FOCUS_SUMMARY_RETRY_DELAYS_MILLISECONDS[index];
}