export const STUDY_EVENT_ERROR_CODES = [
  "FEATURE_DISABLED",
  "INVALID_EVENT",
  "INVALID_EVIDENCE",
  "IDEMPOTENCY_CONFLICT",
  "OWNERSHIP_MISMATCH",
  "CANONICAL_REFERENCE_NOT_FOUND",
  "OUTBOX_FAILURE",
] as const;

export type StudyEventErrorCode = (typeof STUDY_EVENT_ERROR_CODES)[number];

export class StudyEventError extends Error {
  readonly code: StudyEventErrorCode;
  readonly reason: string;

  constructor(code: StudyEventErrorCode, reason: string) {
    super(reason);
    this.name = "StudyEventError";
    this.code = code;
    this.reason = reason;
  }
}