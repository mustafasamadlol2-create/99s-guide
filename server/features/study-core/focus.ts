import {
  FOCUS_STATE_MACHINE_VERSION,
} from "./constants.js";

export const FOCUS_SESSION_STATES = [
  "CREATED",
  "ACTIVE",
  "PAUSED",
  "RESOURCE_HANDOFF",
  "COMPLETED",
  "ABANDONED",
  "EXPIRED",
  "RECONCILIATION_REQUIRED",
] as const;

export type FocusSessionState = (typeof FOCUS_SESSION_STATES)[number];

export const FOCUS_TERMINAL_STATES = [
  "COMPLETED",
  "ABANDONED",
  "EXPIRED",
] as const satisfies readonly FocusSessionState[];

export const FOCUS_ALLOWED_TRANSITIONS: Readonly<
  Record<FocusSessionState, readonly FocusSessionState[]>
> = {
  CREATED: ["ACTIVE", "ABANDONED"],
  ACTIVE: [
    "PAUSED",
    "RESOURCE_HANDOFF",
    "COMPLETED",
    "ABANDONED",
    "EXPIRED",
    "RECONCILIATION_REQUIRED",
  ],
  PAUSED: [
    "ACTIVE",
    "RESOURCE_HANDOFF",
    "ABANDONED",
    "EXPIRED",
    "RECONCILIATION_REQUIRED",
  ],
  RESOURCE_HANDOFF: [
    "ACTIVE",
    "PAUSED",
    "ABANDONED",
    "RECONCILIATION_REQUIRED",
  ],
  COMPLETED: [],
  ABANDONED: [],
  EXPIRED: [],
  RECONCILIATION_REQUIRED: ["COMPLETED", "ABANDONED", "EXPIRED"],
};

export function canTransitionFocusSession(
  from: FocusSessionState,
  to: FocusSessionState,
): boolean {
  return FOCUS_ALLOWED_TRANSITIONS[from].includes(to);
}

export interface FocusPlanItem {
  lectureId: string;
  sequence: number;
  sessionCount: number;
  focusDurationSeconds: number;
  breakDurationSeconds: number;
  includeMcq: boolean;
  includeFlashcards: boolean;
  includeVideo: boolean;
}

export const FOCUS_RESOURCE_TYPES = [
  "PDF_MATERIAL",
  "NOTES",
  "VIDEO",
  "OTHER_ACADEMIC_RESOURCE",
] as const;

export type FocusResourceType = (typeof FOCUS_RESOURCE_TYPES)[number];

export const FOCUS_HANDOFF_STATUSES = [
  "STARTED",
  "RETURNED",
  "TIMEOUT",
  "UNKNOWN",
] as const;

export type FocusHandoffStatus = (typeof FOCUS_HANDOFF_STATUSES)[number];

/**
 * Opening a resource does not prove reading. Returning does not prove
 * completion, and external viewer duration is not verified study time.
 * Future Focus lifecycle code must use server timestamps for timer recovery.
 */
export type FocusResourceHandoff = {
  resourceType: FocusResourceType;
  resourceId?: string;
  status: FocusHandoffStatus;
  startedAt: string;
  returnedAt?: string;
};

export { FOCUS_STATE_MACHINE_VERSION };