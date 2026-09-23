export const GROUP_FOCUS_MODES = ["SHARED_LECTURE", "STUDY_TOGETHER"] as const;
export type GroupFocusMode = (typeof GROUP_FOCUS_MODES)[number];

export const GROUP_FOCUS_PARTICIPANT_ROLES = ["HOST", "MEMBER"] as const;
export type GroupFocusParticipantRole =
  (typeof GROUP_FOCUS_PARTICIPANT_ROLES)[number];

export const GROUP_FOCUS_ROOM_PHASES = [
  "LOBBY",
  "COUNTDOWN",
  "FOCUS",
  "BREAK",
  "PAUSED",
  "COMPLETED",
  "CLOSED",
] as const;
export type GroupFocusRoomPhase = (typeof GROUP_FOCUS_ROOM_PHASES)[number];

export type GroupFocusCapabilityClaims = {
  userId: string;
  roomId: string;
  role: GroupFocusParticipantRole;
  expiresAt: string;
  nonce: string;
  allowedActions: readonly string[];
};

export const GROUP_FOCUS_CONFIG_DEFAULTS = {
  defaultMaxRoomSize: 12,
  absoluteSafetyCeiling: 25,
  reconnectGracePeriodSeconds: 90,
  idleTimeoutSeconds: 15 * 60,
  maximumRoomLifetimeSeconds: 8 * 60 * 60,
} as const;

// These are configuration-ready recommendations only; no room behavior is active.