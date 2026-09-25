import type { FocusSessionState } from "../study-core/focus.js";
import { canTransitionFocusSession } from "../study-core/focus.js";

/** A session may not be recovered after this much wall-clock time. */
export const FOCUS_TIMER_MAX_AGE_SECONDS = 48 * 60 * 60;
/** Focus Plans cap a single uninterrupted study segment at six hours. */
export const FOCUS_TIMER_MAX_TARGET_SECONDS = 6 * 60 * 60;
/** Completion is intentionally tolerant of a small timestamp/checkpoint delay. */
export const FOCUS_TIMER_COMPLETION_TOLERANCE_SECONDS = 2;
export const COMPLETION_TOLERANCE_SECONDS = FOCUS_TIMER_COMPLETION_TOLERANCE_SECONDS;

export type FocusTimerStatus =
  | "OK"
  | "SESSION_READY_TO_COMPLETE"
  | "SESSION_NOT_READY"
  | "INVALID_SESSION_STATE"
  | "RECONCILIATION_REQUIRED";

/** The persisted fields needed by the timer. No plan or plan-item data is used. */
export interface FocusTimerSession {
  status: FocusSessionState;
  startedAt: string | Date | null;
  plannedEndAt: string | Date | null;
  lastCheckpointAt: string | Date | null;
  activeSeconds: number;
  pauseSeconds: number;
}

export interface FocusTimerSnapshot {
  status: FocusTimerStatus;
  state: FocusSessionState;
  targetSeconds: number | null;
  activeSeconds: number | null;
  elapsedActiveSeconds: number | null;
  remainingSeconds: number | null;
  completionEligible: boolean;
  reconciliationRequired: boolean;
}

export interface FocusTimerActionResult {
  status: FocusTimerStatus;
  state: FocusSessionState;
  startedAt: string | Date | null;
  plannedEndAt: string | Date | null;
  lastCheckpointAt: string | Date | null;
  activeSeconds: number | null;
  pauseSeconds: number | null;
  actualEndedAt?: string | Date;
  reconciliationRequired: boolean;
}

type Parsed = { start: number; end: number; checkpoint: number; now: number };

function timestamp(value: string | Date | null): number {
  const milliseconds = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(milliseconds)) throw new Error("invalid timestamp");
  return milliseconds;
}

function integer(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function parse(session: FocusTimerSession, now: string | Date): Parsed | null {
  try {
    const start = timestamp(session.startedAt);
    const end = timestamp(session.plannedEndAt);
    const checkpoint = timestamp(session.lastCheckpointAt);
    const current = timestamp(now);
    if (!integer(session.activeSeconds) || !integer(session.pauseSeconds)) return null;
    if (end < start || checkpoint < start || checkpoint > current || current < start) return null;
    if ((current - start) / 1000 > FOCUS_TIMER_MAX_AGE_SECONDS) return null;
    // A counter larger than the entire recovery horizon cannot be authentic.
    if (session.activeSeconds > FOCUS_TIMER_MAX_AGE_SECONDS || session.pauseSeconds > FOCUS_TIMER_MAX_AGE_SECONDS) return null;
    return { start, end, checkpoint, now: current };
  } catch {
    return null;
  }
}

function invalid(): FocusTimerSnapshot {
  return {
    status: "RECONCILIATION_REQUIRED",
    state: "RECONCILIATION_REQUIRED",
    targetSeconds: null,
    activeSeconds: null,
    elapsedActiveSeconds: null,
    remainingSeconds: null,
    completionEligible: false,
    reconciliationRequired: true,
  };
}

function calculation(session: FocusTimerSession, now: string | Date) {
  const parsed = parse(session, now);
  if (!parsed) return null;
  const target = Math.floor((parsed.end - parsed.start) / 1000) - session.pauseSeconds;
  if (!Number.isSafeInteger(target) || target < 0 || target > FOCUS_TIMER_MAX_TARGET_SECONDS) return null;
  const live = session.status === "ACTIVE" ? Math.floor((parsed.now - parsed.checkpoint) / 1000) : 0;
  const elapsed = session.activeSeconds + live;
  if (!Number.isSafeInteger(elapsed) || elapsed < session.activeSeconds) return null;
  return { ...parsed, target, live, elapsed, active: Math.min(elapsed, target) };
}

/** Builds a read-only timer view using only persisted timestamps and counters. */
export function buildFocusTimerSnapshot(input: { session: FocusTimerSession; now: string | Date }): FocusTimerSnapshot {
  const result = calculation(input.session, input.now);
  if (!result) return invalid();
  const completionEligible =
    input.session.status === "ACTIVE" &&
    canTransitionFocusSession(input.session.status, "COMPLETED") &&
    result.elapsed + FOCUS_TIMER_COMPLETION_TOLERANCE_SECONDS >= result.target;
  return {
    status: "OK",
    state: input.session.status,
    targetSeconds: result.target,
    activeSeconds: input.session.activeSeconds,
    elapsedActiveSeconds: result.elapsed,
    remainingSeconds: Math.max(0, result.target - result.elapsed),
    completionEligible,
    reconciliationRequired: false,
  };
}

function actionBase(session: FocusTimerSession, status: FocusTimerStatus, state: FocusSessionState, values: Partial<FocusTimerActionResult>): FocusTimerActionResult {
  return { ...session, status, state, reconciliationRequired: status === "RECONCILIATION_REQUIRED", ...values };
}

/** Checkpoints an active segment and enters PAUSED, without consuming focus time. */
export function pauseFocusTimer(session: FocusTimerSession, now: string | Date): FocusTimerActionResult {
  const c = calculation(session, now);
  if (
    !c ||
    session.status !== "ACTIVE" ||
    !canTransitionFocusSession(session.status, "PAUSED")
  ) {
    return actionBase(session, "RECONCILIATION_REQUIRED", "RECONCILIATION_REQUIRED", { activeSeconds: null, pauseSeconds: null });
  }
  if (c.elapsed >= c.target) return actionBase(session, "SESSION_READY_TO_COMPLETE", "ACTIVE", { activeSeconds: c.active, pauseSeconds: session.pauseSeconds, lastCheckpointAt: now });
  return actionBase(session, "OK", "PAUSED", { activeSeconds: c.elapsed, pauseSeconds: session.pauseSeconds, lastCheckpointAt: now });
}

/** Resumes a pause, adding its wall-clock length and shifting the planned end equally. */
export function resumeFocusTimer(session: FocusTimerSession, now: string | Date): FocusTimerActionResult {
  const c = calculation(session, now);
  if (
    !c ||
    session.status !== "PAUSED" ||
    !canTransitionFocusSession(session.status, "ACTIVE")
  ) {
    return actionBase(session, "RECONCILIATION_REQUIRED", "RECONCILIATION_REQUIRED", { activeSeconds: null, pauseSeconds: null });
  }
  const paused = Math.floor((c.now - c.checkpoint) / 1000);
  const plannedEndAt = new Date(c.end + paused * 1000).toISOString();
  return actionBase(session, "OK", "ACTIVE", { lastCheckpointAt: now, pauseSeconds: session.pauseSeconds + paused, plannedEndAt });
}

/** Completes only when server-derived active time is within the tolerance. */
export function completeFocusTimer(session: FocusTimerSession, now: string | Date): FocusTimerActionResult {
  // Ordinary completion is supported only from ACTIVE. The shared contract
  // also permits reconciliation completion, which requires a separate
  // validated flow that this timer helper intentionally does not implement.
  if (
    session.status !== "ACTIVE" ||
    !canTransitionFocusSession(session.status, "COMPLETED")
  ) {
    return actionBase(session, "INVALID_SESSION_STATE", session.status, {});
  }
  const c = calculation(session, now);
  if (!c) return actionBase(session, "RECONCILIATION_REQUIRED", "RECONCILIATION_REQUIRED", { activeSeconds: null, pauseSeconds: null });
  if (c.elapsed + FOCUS_TIMER_COMPLETION_TOLERANCE_SECONDS < c.target) {
    return actionBase(session, "SESSION_NOT_READY", session.status, { activeSeconds: c.active });
  }
  return actionBase(session, "OK", "COMPLETED", { activeSeconds: c.active, actualEndedAt: now });
}

/** Abandonment records server-derived active time but never marks completion. */
export function abandonFocusTimer(session: FocusTimerSession, now: string | Date): FocusTimerActionResult {
  const c = calculation(session, now);
  if (!c) return actionBase(session, "RECONCILIATION_REQUIRED", "RECONCILIATION_REQUIRED", { activeSeconds: null, pauseSeconds: null });
  return actionBase(session, "OK", "ABANDONED", { activeSeconds: c.active, actualEndedAt: now });
}