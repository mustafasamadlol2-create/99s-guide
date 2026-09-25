import type {
  GroupFocusCapabilityMode,
  GroupFocusCapabilityRole,
} from "../group-focus-capability/contract.js";

export const GROUP_FOCUS_REALTIME_PROTOCOL = "gf-v1";
export const GROUP_FOCUS_REALTIME_AUTH_PREFIX = "gf-auth.";
export const GROUP_FOCUS_REALTIME_RESUME_PREFIX = "gf-resume.";
export const GROUP_FOCUS_REALTIME_MAX_MESSAGE_BYTES = 16 * 1024;
export const GROUP_FOCUS_REALTIME_COUNTDOWN_SECONDS = 3;
export const GROUP_FOCUS_REALTIME_INTERNAL_CAPABILITY_HEADER =
  "x-group-focus-internal-capability";
export const GROUP_FOCUS_REALTIME_INTERNAL_RESUME_HEADER =
  "x-group-focus-internal-resume";

export const GROUP_FOCUS_REALTIME_CONNECTION_STATES = [
  "CONNECTED",
  "RECONNECTING",
] as const;
export type GroupFocusRealtimeConnectionState =
  (typeof GROUP_FOCUS_REALTIME_CONNECTION_STATES)[number];

export const GROUP_FOCUS_REALTIME_PHASES = [
  "LOBBY",
  "COUNTDOWN",
  "FOCUS",
  "BREAK",
  "PAUSED",
  "COMPLETED",
  "CLOSED",
] as const;

export type GroupFocusRealtimePhase = (typeof GROUP_FOCUS_REALTIME_PHASES)[number];
export type GroupFocusTimedPhase = "COUNTDOWN" | "FOCUS" | "BREAK";

export type GroupFocusRealtimeRoomState = {
  mode: GroupFocusCapabilityMode;
  phase: GroupFocusRealtimePhase;
  currentRound: number;
  roundCount: number;
  focusDurationSeconds: number;
  breakDurationSeconds: number;
  maxParticipants: number;
  phaseStartedAt: number | null;
  phaseEndsAt: number | null;
  pausedFromPhase: GroupFocusTimedPhase | null;
  pausedRemainingMilliseconds: number | null;
};

export type GroupFocusRealtimeParticipant = {
  userId: string;
  role: GroupFocusCapabilityRole;
  effectiveLectureId: string;
  connectedAt: number;
  connectionState?: GroupFocusRealtimeConnectionState;
};

export type GroupFocusRealtimeSocketAttachment = GroupFocusRealtimeParticipant & {
  connectionId: string;
  membershipId: string;
};

export type GroupFocusRealtimeClientMessageType =
  | "ROOM_STATE_REQUEST"
  | "CLIENT_LEAVE"
  | "HOST_START"
  | "HOST_PAUSE"
  | "HOST_RESUME"
  | "HOST_CLOSE";

export type GroupFocusRealtimeClientMessage = {
  v: 1;
  type: GroupFocusRealtimeClientMessageType;
};

export type GroupFocusRealtimeServerMessageType =
  | "CONNECTED"
  | "RESUME_TOKEN"
  | "ROOM_STATE"
  | "PRESENCE_SNAPSHOT"
  | "PRESENCE_JOINED"
  | "PRESENCE_LEFT"
  | "PHASE_CHANGED"
  | "ERROR"
  | "ROOM_CLOSED";

export type GroupFocusRealtimeServerMessage = {
  v: 1;
  type: GroupFocusRealtimeServerMessageType;
  revision: number;
  serverNow: number;
  payload: Record<string, unknown>;
};

const CLIENT_MESSAGE_TYPES: readonly string[] = [
  "ROOM_STATE_REQUEST",
  "CLIENT_LEAVE",
  "HOST_START",
  "HOST_PAUSE",
  "HOST_RESUME",
  "HOST_CLOSE",
];

const SERVER_MESSAGE_TYPES: readonly string[] = [
  "CONNECTED",
  "RESUME_TOKEN",
  "ROOM_STATE",
  "PRESENCE_SNAPSHOT",
  "PRESENCE_JOINED",
  "PRESENCE_LEFT",
  "PHASE_CHANGED",
  "ERROR",
  "ROOM_CLOSED",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length
    && actual.every((key, index) => key === sorted[index]);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRoomState(value: unknown): value is GroupFocusRealtimeRoomState {
  if (!isRecord(value) || !hasExactKeys(value, [
    "mode",
    "phase",
    "currentRound",
    "roundCount",
    "focusDurationSeconds",
    "breakDurationSeconds",
    "maxParticipants",
    "phaseStartedAt",
    "phaseEndsAt",
    "pausedFromPhase",
    "pausedRemainingMilliseconds",
  ])) {
    return false;
  }

  const timedPhases = ["COUNTDOWN", "FOCUS", "BREAK"];
  return (
    (value.mode === "SHARED_LECTURE" || value.mode === "STUDY_TOGETHER")
    && GROUP_FOCUS_REALTIME_PHASES.includes(value.phase as GroupFocusRealtimePhase)
    && isSafeInteger(value.currentRound)
    && isSafeInteger(value.roundCount)
    && value.roundCount >= 1
    && value.currentRound <= value.roundCount
    && isSafeInteger(value.focusDurationSeconds)
    && isSafeInteger(value.breakDurationSeconds)
    && isSafeInteger(value.maxParticipants)
    && (value.phaseStartedAt === null || isSafeInteger(value.phaseStartedAt))
    && (value.phaseEndsAt === null || isSafeInteger(value.phaseEndsAt))
    && (
      value.pausedFromPhase === null
      || timedPhases.includes(value.pausedFromPhase as string)
    )
    && (
      value.pausedRemainingMilliseconds === null
      || isSafeInteger(value.pausedRemainingMilliseconds)
    )
  );
}

function isParticipant(value: unknown): value is GroupFocusRealtimeParticipant {
  if (!isRecord(value)) {
    return false;
  }
  const baseKeys = ["userId", "role", "effectiveLectureId", "connectedAt"];
  const actualKeys = Object.keys(value).sort();
  const withState = [...baseKeys, "connectionState"].sort();
  if (
    actualKeys.length !== baseKeys.length
      && actualKeys.length !== withState.length
  ) return false;
  if (
    !hasExactKeys(value, actualKeys.length === baseKeys.length ? baseKeys : withState)
  ) return false;
  return (
    typeof value.userId === "string"
    && value.userId.length > 0
    && (value.role === "HOST" || value.role === "MEMBER")
    && typeof value.effectiveLectureId === "string"
    && value.effectiveLectureId.length > 0
    && isSafeInteger(value.connectedAt)
    && (
      value.connectionState === undefined
      || GROUP_FOCUS_REALTIME_CONNECTION_STATES.includes(
        value.connectionState as GroupFocusRealtimeConnectionState,
      )
    )
  );
}

export function parseGroupFocusRealtimeClientMessage(
  input: string,
): GroupFocusRealtimeClientMessage | null {
  if (new TextEncoder().encode(input).byteLength > GROUP_FOCUS_REALTIME_MAX_MESSAGE_BYTES) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(input) as unknown;
  } catch {
    return null;
  }
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["v", "type"])
    || value.v !== 1
    || typeof value.type !== "string"
    || !CLIENT_MESSAGE_TYPES.includes(value.type)
  ) {
    return null;
  }
  return value as GroupFocusRealtimeClientMessage;
}

export function parseGroupFocusRealtimeServerMessage(
  input: unknown,
): GroupFocusRealtimeServerMessage | null {
  let value = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).byteLength > GROUP_FOCUS_REALTIME_MAX_MESSAGE_BYTES) {
      return null;
    }
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return null;
    }
  } else if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    const bytes = input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (bytes.byteLength > GROUP_FOCUS_REALTIME_MAX_MESSAGE_BYTES) return null;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    } catch {
      return null;
    }
  }

  if (
    !isRecord(value)
    || !hasExactKeys(value, ["v", "type", "revision", "serverNow", "payload"])
    || value.v !== 1
    || typeof value.type !== "string"
    || !SERVER_MESSAGE_TYPES.includes(value.type)
    || !isSafeInteger(value.revision)
    || !isSafeInteger(value.serverNow)
    || !isRecord(value.payload)
  ) {
    return null;
  }

  const payload = value.payload;
  switch (value.type) {
    case "CONNECTED":
      if (
        !hasExactKeys(payload, ["connectionId", "userId", "role", "roomId"])
        || typeof payload.connectionId !== "string"
        || typeof payload.userId !== "string"
        || (payload.role !== "HOST" && payload.role !== "MEMBER")
        || typeof payload.roomId !== "string"
      ) return null;
      break;
    case "RESUME_TOKEN":
      if (
        !hasExactKeys(payload, ["resumeToken"])
        || typeof payload.resumeToken !== "string"
        || !/^[A-Za-z0-9_-]{43}$/u.test(payload.resumeToken)
      ) return null;
      break;
    case "ROOM_STATE":
    case "PHASE_CHANGED":
    case "ROOM_CLOSED":
      if (!hasExactKeys(payload, ["roomState"]) || !isRoomState(payload.roomState)) return null;
      break;
    case "PRESENCE_SNAPSHOT":
      if (
        !hasExactKeys(payload, ["sequence", "participants"])
        || !isSafeInteger(payload.sequence)
        || !Array.isArray(payload.participants)
        || !payload.participants.every(isParticipant)
      ) return null;
      break;
    case "PRESENCE_JOINED":
    case "PRESENCE_LEFT":
      if (
        !hasExactKeys(payload, ["sequence", "participant"])
        || !isSafeInteger(payload.sequence)
        || !isParticipant(payload.participant)
      ) return null;
      break;
    case "ERROR":
      if (
        !hasExactKeys(payload, ["code"])
        || typeof payload.code !== "string"
        || payload.code.length === 0
        || payload.code.length > 64
      ) return null;
      break;
  }

  return value as GroupFocusRealtimeServerMessage;
}