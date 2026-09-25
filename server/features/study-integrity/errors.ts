export const INTEGRITY_ERROR_CODES = [
  "INTEGRITY_POLICY_NOT_FOUND",
  "INTEGRITY_INVALID_INPUT",
  "INTEGRITY_SOURCE_NOT_ALLOWED",
  "INTEGRITY_EVIDENCE_INSUFFICIENT",
  "INTEGRITY_IDEMPOTENCY_CONFLICT",
] as const;

export type IntegrityErrorCode = (typeof INTEGRITY_ERROR_CODES)[number];

export class StudyIntegrityError extends Error {
  constructor(
    public readonly code: IntegrityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StudyIntegrityError";
  }
}