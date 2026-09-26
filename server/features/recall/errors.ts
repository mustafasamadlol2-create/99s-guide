export type RecallErrorCode =
  | "INVALID_RECALL_INPUT"
  | "RECALL_USER_NOT_FOUND"
  | "RECALL_SOURCE_NOT_FOUND"
  | "RECALL_SOURCE_INVALID"
  | "RECALL_SOURCE_CHANGED"
  | "RECALL_ISSUANCE_CONFLICT"
  | "RECALL_ATTEMPT_NOT_FOUND"
  | "RECALL_ATTEMPT_FINALIZED"
  | "RECALL_ANSWER_KIND_MISMATCH"
  | "NO_RECALL_CANDIDATE"
  | "RECALL_STATE_CORRUPT"
  | "RECALL_COUNTER_OVERFLOW";

const statusByCode: Record<RecallErrorCode, number> = {
  INVALID_RECALL_INPUT: 400,
  RECALL_USER_NOT_FOUND: 404,
  RECALL_SOURCE_NOT_FOUND: 404,
  RECALL_SOURCE_INVALID: 409,
  RECALL_SOURCE_CHANGED: 409,
  RECALL_ISSUANCE_CONFLICT: 409,
  RECALL_ATTEMPT_NOT_FOUND: 404,
  RECALL_ATTEMPT_FINALIZED: 409,
  RECALL_ANSWER_KIND_MISMATCH: 400,
  NO_RECALL_CANDIDATE: 404,
  RECALL_STATE_CORRUPT: 409,
  RECALL_COUNTER_OVERFLOW: 409,
};

export class RecallError extends Error {
  readonly status: number;

  constructor(
    readonly code: RecallErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RecallError";
    this.status = statusByCode[code];
  }
}

export function isRecallError(error: unknown): error is RecallError {
  return error instanceof RecallError;
}