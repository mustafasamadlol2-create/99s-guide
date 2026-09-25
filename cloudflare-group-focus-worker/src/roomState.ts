import type {
  GroupFocusCapabilityMode,
  GroupFocusCapabilityRole,
  GroupFocusCapabilityVisibility,
  VerifiedGroupFocusCapability,
} from "../../shared/group-focus-capability/contract.js";
import {
  GROUP_FOCUS_REALTIME_COUNTDOWN_SECONDS,
  GROUP_FOCUS_REALTIME_PHASES,
  type GroupFocusRealtimeSocketAttachment,
  type GroupFocusRealtimePhase,
  type GroupFocusTimedPhase,
} from "../../shared/group-focus-realtime/protocol.js";

export const GROUP_FOCUS_ROOM_STATE_VERSION = 1 as const;
const COUNTDOWN_MILLISECONDS = GROUP_FOCUS_REALTIME_COUNTDOWN_SECONDS * 1000;

export type GroupFocusRoomState = {
  stateVersion: typeof GROUP_FOCUS_ROOM_STATE_VERSION;
  roomId: string;
  mode: GroupFocusCapabilityMode;
  visibility: GroupFocusCapabilityVisibility;
  focusDurationSeconds: number;
  breakDurationSeconds: number;
  roundCount: number;
  maxParticipants: number;
  phase: GroupFocusRealtimePhase;
  currentRound: number;
  connections: GroupFocusRealtimeSocketAttachment[];
  phaseStartedAt: number | null;
  phaseEndsAt: number | null;
  pausedFromPhase: GroupFocusTimedPhase | null;
  pausedRemainingMilliseconds: number | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
};

export type DueTransitionResult = {
  state: GroupFocusRoomState;
  transitions: GroupFocusRoomState[];
};

const TIMED_PHASES: readonly GroupFocusTimedPhase[] = ["COUNTDOWN", "FOCUS", "BREAK"];

export function createInitialGroupFocusRoomState(
  capability: VerifiedGroupFocusCapability,
  now: number,
): GroupFocusRoomState {
  return {
    stateVersion: GROUP_FOCUS_ROOM_STATE_VERSION,
    roomId: capability.roomId,
    mode: capability.mode,
    visibility: capability.visibility,
    focusDurationSeconds: capability.focusDurationSeconds,
    breakDurationSeconds: capability.breakDurationSeconds,
    roundCount: capability.roundCount,
    maxParticipants: capability.maxParticipants,
    phase: "LOBBY",
    currentRound: 0,
    connections: [],
    phaseStartedAt: null,
    phaseEndsAt: null,
    pausedFromPhase: null,
    pausedRemainingMilliseconds: null,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function groupFocusRoomConfigurationMatches(
  state: GroupFocusRoomState,
  capability: VerifiedGroupFocusCapability,
): boolean {
  return state.stateVersion === GROUP_FOCUS_ROOM_STATE_VERSION
    && state.roomId === capability.roomId
    && state.mode === capability.mode
    && state.visibility === capability.visibility
    && state.focusDurationSeconds === capability.focusDurationSeconds
    && state.breakDurationSeconds === capability.breakDurationSeconds
    && state.roundCount === capability.roundCount
    && state.maxParticipants === capability.maxParticipants;
}

export function isValidGroupFocusRoomState(value: unknown): value is GroupFocusRoomState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  const expectedKeys = [
    "stateVersion",
    "roomId",
    "mode",
    "visibility",
    "focusDurationSeconds",
    "breakDurationSeconds",
    "roundCount",
    "maxParticipants",
    "phase",
    "currentRound",
    "connections",
    "phaseStartedAt",
    "phaseEndsAt",
    "pausedFromPhase",
    "pausedRemainingMilliseconds",
    "revision",
    "createdAt",
    "updatedAt",
  ].sort();
  const actualKeys = Object.keys(state).sort();
  const integer = (item: unknown): item is number =>
    typeof item === "number" && Number.isSafeInteger(item) && item >= 0;
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index])
    && state.stateVersion === GROUP_FOCUS_ROOM_STATE_VERSION
    && typeof state.roomId === "string"
    && (state.mode === "SHARED_LECTURE" || state.mode === "STUDY_TOGETHER")
    && (state.visibility === "PUBLIC" || state.visibility === "PRIVATE")
    && integer(state.focusDurationSeconds)
    && integer(state.breakDurationSeconds)
    && integer(state.roundCount)
    && integer(state.maxParticipants)
    && GROUP_FOCUS_REALTIME_PHASES.includes(state.phase as GroupFocusRealtimePhase)
    && integer(state.currentRound)
    && state.currentRound <= state.roundCount
    && Array.isArray(state.connections)
    && state.connections.length <= state.maxParticipants
    && state.connections.every((participant) => {
      if (
        typeof participant !== "object"
        || participant === null
        || Array.isArray(participant)
      ) return false;
      const record = participant as Record<string, unknown>;
      return (
        typeof record.connectionId === "string"
        && record.connectionId.length > 0
        && typeof record.userId === "string"
        && typeof record.membershipId === "string"
        && (record.role === "HOST" || record.role === "MEMBER")
        && typeof record.effectiveLectureId === "string"
        && integer(record.connectedAt)
      );
    })
    && (state.phaseStartedAt === null || integer(state.phaseStartedAt))
    && (state.phaseEndsAt === null || integer(state.phaseEndsAt))
    && (
      state.pausedFromPhase === null
      || TIMED_PHASES.includes(state.pausedFromPhase as GroupFocusTimedPhase)
    )
    && (
      state.pausedRemainingMilliseconds === null
      || integer(state.pausedRemainingMilliseconds)
    )
    && integer(state.revision)
    && integer(state.createdAt)
    && integer(state.updatedAt);
}

export function startGroupFocusCountdown(
  state: GroupFocusRoomState,
  now: number,
): GroupFocusRoomState | null {
  if (state.phase !== "LOBBY") return null;
  return {
    ...state,
    phase: "COUNTDOWN",
    phaseStartedAt: now,
    phaseEndsAt: now + COUNTDOWN_MILLISECONDS,
    revision: state.revision + 1,
    updatedAt: now,
  };
}

function transitionAt(
  state: GroupFocusRoomState,
  boundary: number,
  updatedAt: number,
): GroupFocusRoomState | null {
  switch (state.phase) {
    case "COUNTDOWN": {
      const nextRound = state.currentRound === 0 ? 1 : state.currentRound + 1;
      if (nextRound > state.roundCount) return null;
      return {
        ...state,
        phase: "FOCUS",
        currentRound: nextRound,
        phaseStartedAt: boundary,
        phaseEndsAt: boundary + state.focusDurationSeconds * 1000,
        revision: state.revision + 1,
        updatedAt,
      };
    }
    case "FOCUS":
      if (state.currentRound >= state.roundCount) {
        return {
          ...state,
          phase: "COMPLETED",
          phaseStartedAt: boundary,
          phaseEndsAt: null,
          pausedFromPhase: null,
          pausedRemainingMilliseconds: null,
          revision: state.revision + 1,
          updatedAt,
        };
      }
      if (state.breakDurationSeconds === 0) {
        return {
          ...state,
          phase: "COUNTDOWN",
          phaseStartedAt: boundary,
          phaseEndsAt: boundary + COUNTDOWN_MILLISECONDS,
          revision: state.revision + 1,
          updatedAt,
        };
      }
      return {
        ...state,
        phase: "BREAK",
        phaseStartedAt: boundary,
        phaseEndsAt: boundary + state.breakDurationSeconds * 1000,
        revision: state.revision + 1,
        updatedAt,
      };
    case "BREAK":
      return {
        ...state,
        phase: "COUNTDOWN",
        phaseStartedAt: boundary,
        phaseEndsAt: boundary + COUNTDOWN_MILLISECONDS,
        revision: state.revision + 1,
        updatedAt,
      };
    default:
      return null;
  }
}

export function advanceGroupFocusRoomState(
  initial: GroupFocusRoomState,
  now: number,
): DueTransitionResult {
  let state = initial;
  const transitions: GroupFocusRoomState[] = [];
  const maxTransitions = state.roundCount * 3 + 2;

  for (let count = 0; count < maxTransitions; count += 1) {
    const deadline = state.phaseEndsAt;
    if (deadline === null || deadline > now) break;
    const next = transitionAt(state, deadline, now);
    if (!next) break;
    state = next;
    transitions.push(state);
  }

  return { state, transitions };
}

export function pauseGroupFocusRoom(
  state: GroupFocusRoomState,
  now: number,
): GroupFocusRoomState | null {
  if (
    state.phase !== "COUNTDOWN"
    && state.phase !== "FOCUS"
    && state.phase !== "BREAK"
  ) {
    return null;
  }
  if (state.phaseEndsAt === null) return null;
  return {
    ...state,
    phase: "PAUSED",
    phaseStartedAt: now,
    phaseEndsAt: null,
    pausedFromPhase: state.phase,
    pausedRemainingMilliseconds: Math.max(0, state.phaseEndsAt - now),
    revision: state.revision + 1,
    updatedAt: now,
  };
}

export function resumeGroupFocusRoom(
  state: GroupFocusRoomState,
  now: number,
): GroupFocusRoomState | null {
  if (
    state.phase !== "PAUSED"
    || state.pausedFromPhase === null
    || state.pausedRemainingMilliseconds === null
  ) {
    return null;
  }
  return {
    ...state,
    phase: state.pausedFromPhase,
    phaseStartedAt: now,
    phaseEndsAt: now + state.pausedRemainingMilliseconds,
    pausedFromPhase: null,
    pausedRemainingMilliseconds: null,
    revision: state.revision + 1,
    updatedAt: now,
  };
}

export function closeGroupFocusRoom(
  state: GroupFocusRoomState,
  now: number,
): GroupFocusRoomState | null {
  if (state.phase === "COMPLETED" || state.phase === "CLOSED") return null;
  return {
    ...state,
    phase: "CLOSED",
    phaseStartedAt: now,
    phaseEndsAt: null,
    pausedFromPhase: null,
    pausedRemainingMilliseconds: null,
    revision: state.revision + 1,
    updatedAt: now,
  };
}