import {
  GROUP_FOCUS_CAPABILITY_MODES,
  GROUP_FOCUS_CAPABILITY_ROLES,
  type GroupFocusCapabilityClaims as SignedGroupFocusCapabilityClaims,
  type GroupFocusCapabilityMode,
  type GroupFocusCapabilityRole,
} from "../../../shared/group-focus-capability/contract.js";

export const GROUP_FOCUS_MODES = GROUP_FOCUS_CAPABILITY_MODES;
export type GroupFocusMode = GroupFocusCapabilityMode;

export const GROUP_FOCUS_PARTICIPANT_ROLES = GROUP_FOCUS_CAPABILITY_ROLES;
export type GroupFocusParticipantRole = GroupFocusCapabilityRole;

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

export type GroupFocusCapabilityClaims = SignedGroupFocusCapabilityClaims;

export const GROUP_FOCUS_CONFIG_DEFAULTS = {
  defaultMaxRoomSize: 12,
  absoluteSafetyCeiling: 25,
  reconnectGracePeriodSeconds: 90,
  idleTimeoutSeconds: 15 * 60,
  maximumRoomLifetimeSeconds: 8 * 60 * 60,
} as const;

// These are configuration-ready recommendations only; no room behavior is active.