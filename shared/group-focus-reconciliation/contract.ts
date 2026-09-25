import type {
  GroupFocusCapabilityMode,
  GroupFocusCapabilityRole,
  GroupFocusCapabilityVisibility,
} from "../group-focus-capability/contract.js";

export const GROUP_FOCUS_CANONICAL_RECONCILIATION_INTERVAL_SECONDS = 60;
export const GROUP_FOCUS_RECONNECT_GRACE_SECONDS = 45;
export const GROUP_FOCUS_RESUME_TOKEN_TTL_SECONDS = 10 * 60;
export const GROUP_FOCUS_RUNTIME_IDLE_TIMEOUT_SECONDS = 30 * 60;
export const GROUP_FOCUS_SUMMARY_ACK_RETENTION_SECONDS = 15 * 60;
export const GROUP_FOCUS_SUMMARY_RETRY_RETENTION_SECONDS = 24 * 60 * 60;
export const GROUP_FOCUS_SUMMARY_MAX_BODY_BYTES = 256 * 1024;
export const GROUP_FOCUS_SUMMARY_VERSION = 1 as const;
export const GROUP_FOCUS_SUMMARY_TERMINAL_REASONS = [
  "COMPLETED",
  "HOST_CLOSED",
  "CANONICAL_ROOM_CLOSED",
  "LOBBY_IDLE_TIMEOUT",
  "PAUSED_IDLE_TIMEOUT",
] as const;

export type GroupFocusSummaryTerminalReason =
  (typeof GROUP_FOCUS_SUMMARY_TERMINAL_REASONS)[number];

export type GroupFocusRuntimeSnapshotRequest = {
  roomId: string;
  userIds: string[];
  runtimeInstanceId: string;
  runtimeRevision: number;
};

export type GroupFocusCanonicalRoomSnapshot = {
  roomId: string;
  status: "OPEN" | "CLOSED";
  mode: GroupFocusCapabilityMode;
  visibility: GroupFocusCapabilityVisibility;
  sharedLectureId: string | null;
  focusDurationSeconds: number;
  breakDurationSeconds: number;
  roundCount: number;
  maxParticipants: number;
  updatedAt: string;
};

export type GroupFocusCanonicalMembershipSnapshot = {
  userId: string;
  membershipId: string;
  status: "ACTIVE" | "LEFT" | "REMOVED";
  role: GroupFocusCapabilityRole;
  effectiveLectureId: string | null;
  updatedAt: string;
};

export type GroupFocusRuntimeSnapshotResponse = {
  room: GroupFocusCanonicalRoomSnapshot;
  memberships: GroupFocusCanonicalMembershipSnapshot[];
};

export type GroupFocusRuntimeSummaryParticipant = {
  userId: string;
  membershipId: string;
  role: GroupFocusCapabilityRole;
  effectiveLectureId: string;
  firstConnectedAt: string;
  lastDisconnectedAt?: string;
  reconnectCount: number;
  verifiedFocusSeconds: number;
  rounds: Array<{
    roundNumber: number;
    verifiedFocusSeconds: number;
  }>;
};

export type GroupFocusRuntimeSummary = {
  summaryVersion: typeof GROUP_FOCUS_SUMMARY_VERSION;
  summaryId: string;
  runtimeInstanceId: string;
  roomId: string;
  mode: GroupFocusCapabilityMode;
  focusDurationSeconds: number;
  breakDurationSeconds: number;
  roundCount: number;
  runtimeStartedAt: string;
  runtimeEndedAt: string;
  terminalReason: GroupFocusSummaryTerminalReason;
  completedRounds: number;
  finalRevision: number;
  participants: GroupFocusRuntimeSummaryParticipant[];
};

export type GroupFocusRuntimeSummaryAck = {
  summaryId: string;
  status: "APPLIED" | "REPLAY";
  runId: string;
};

export type GroupFocusMyRuntimeSummary = {
  run: {
    runId: string;
    summaryId: string;
    roomId: string;
    mode: GroupFocusCapabilityMode;
    focusDurationSeconds: number;
    breakDurationSeconds: number;
    roundCount: number;
    runtimeStartedAt: string;
    runtimeEndedAt: string;
    terminalReason: GroupFocusSummaryTerminalReason;
    completedRounds: number;
  };
  participant: GroupFocusRuntimeSummaryParticipant;
};