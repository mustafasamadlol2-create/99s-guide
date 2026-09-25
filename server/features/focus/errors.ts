export const FOCUS_ERROR_CODES = [
  "FEATURE_DISABLED",
  "DEPENDENCY_DISABLED",
  "INVALID_REQUEST",
  "PLAN_NOT_FOUND",
  "PLAN_ARCHIVED",
  "PLAN_HAS_ACTIVE_SESSION",
  "PLAN_ITEM_NOT_FOUND",
  "PLAN_ITEM_HAS_HISTORY",
  "LECTURE_NOT_FOUND",
  "ACTIVE_SESSION_EXISTS",
  "SESSION_NOT_FOUND",
  "INVALID_SESSION_STATE",
  "SESSION_READY_TO_COMPLETE",
  "SESSION_NOT_READY_TO_COMPLETE",
  "PLANNED_SESSIONS_COMPLETE",
  "IDEMPOTENCY_CONFLICT",
  "RECONCILIATION_REQUIRED",
  "OUTBOX_FAILURE",
  "RESOURCE_NOT_FOUND",
  "UNSUPPORTED_RESOURCE_TYPE",
  "HANDOFF_SUPPRESSES_INTERRUPTION",
  "INVALID_INTERRUPTION",
] as const;

export type FocusErrorCode = (typeof FOCUS_ERROR_CODES)[number];

const STATUS_BY_CODE: Record<FocusErrorCode, number> = {
  FEATURE_DISABLED: 404,
  DEPENDENCY_DISABLED: 503,
  INVALID_REQUEST: 400,
  PLAN_NOT_FOUND: 404,
  PLAN_ARCHIVED: 409,
  PLAN_HAS_ACTIVE_SESSION: 409,
  PLAN_ITEM_NOT_FOUND: 404,
  PLAN_ITEM_HAS_HISTORY: 409,
  LECTURE_NOT_FOUND: 404,
  ACTIVE_SESSION_EXISTS: 409,
  SESSION_NOT_FOUND: 404,
  INVALID_SESSION_STATE: 409,
  SESSION_READY_TO_COMPLETE: 409,
  SESSION_NOT_READY_TO_COMPLETE: 409,
  PLANNED_SESSIONS_COMPLETE: 409,
  IDEMPOTENCY_CONFLICT: 409,
  RECONCILIATION_REQUIRED: 409,
  OUTBOX_FAILURE: 500,
  RESOURCE_NOT_FOUND: 404,
  UNSUPPORTED_RESOURCE_TYPE: 409,
  HANDOFF_SUPPRESSES_INTERRUPTION: 409,
  INVALID_INTERRUPTION: 409,
};

export class FocusError extends Error {
  readonly status: number;

  constructor(
    readonly code: FocusErrorCode,
    message: string,
    status = STATUS_BY_CODE[code],
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "FocusError";
    this.status = status;
  }
}

export function toFocusError(error: unknown): FocusError | null {
  if (error instanceof FocusError) return error;

  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code);
    if (code === "IDEMPOTENCY_CONFLICT") {
      return new FocusError("IDEMPOTENCY_CONFLICT", "Idempotency key was used for a different operation.");
    }
    if (code === "OUTBOX_FAILURE") {
      return new FocusError("OUTBOX_FAILURE", "Focus projection could not be queued.");
    }
    if (code === "INVALID_EVENT" || code === "INVALID_EVIDENCE") {
      return new FocusError("INVALID_REQUEST", "Focus event did not satisfy the canonical event policy.");
    }
    if (
      code === "OWNERSHIP_MISMATCH" ||
      code === "CANONICAL_REFERENCE_NOT_FOUND"
    ) {
      return new FocusError("PLAN_NOT_FOUND", "Focus resource was not found.");
    }
  }

  return null;
}