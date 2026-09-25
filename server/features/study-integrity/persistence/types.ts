import type {
  IntegrityReviewAction as DbIntegrityReviewAction,
  IntegritySignal as DbIntegritySignal,
} from "@prisma/client";
import type {
  IntegrityObservationCategory,
  IntegrityObservationCode,
  IntegrityObservationSeverity,
} from "../constants.js";

export type IntegritySignalStatus =
  | "OPEN"
  | "ACKNOWLEDGED"
  | "RESOLVED"
  | "DISMISSED";

export type IntegrityReviewActionType =
  | "ACKNOWLEDGE"
  | "RESOLVE"
  | "DISMISS"
  | "REOPEN"
  | "ADD_NOTE";

export type IntegritySignalDto = Pick<
  DbIntegritySignal,
  | "id"
  | "userId"
  | "actionType"
  | "observationCode"
  | "category"
  | "severity"
  | "ruleId"
  | "ruleVersion"
  | "evidenceClass"
  | "source"
  | "privacyClass"
  | "resourceKind"
  | "resourceId"
  | "firstOccurredAt"
  | "lastOccurredAt"
  | "lastReceivedAt"
  | "occurrenceCount"
  | "status"
  | "reviewVersion"
  | "latestSafeDetails"
  | "createdAt"
  | "updatedAt"
  | "resolvedAt"
>;

export type IntegrityReviewActionDto = Pick<
  DbIntegrityReviewAction,
  | "id"
  | "signalId"
  | "reviewerUserId"
  | "fromStatus"
  | "toStatus"
  | "actionType"
  | "note"
  | "createdAt"
>;

export type IntegritySignalListFilters = {
  status?: IntegritySignalStatus;
  includeAllStatuses?: boolean;
  severity?: IntegrityObservationSeverity;
  category?: IntegrityObservationCategory;
  observationCode?: IntegrityObservationCode;
  actionType?: string;
  userId?: string;
  ruleId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
};

export type IntegrityContextInput = {
  userId: string;
  since: Date;
  actionType?: string;
};

export type UserIntegrityContext = {
  openBlockSignals: number;
  openReviewSignals: number;
  recentIdempotencyConflicts: number;
  recentRateSignals: number;
  lastSignalAt: Date | null;
};

export type BlockingIntegritySignalInput = {
  userId: string;
  actionType: string;
  resource?: { kind: string; id: string };
  since: Date;
};

export type BlockingIntegritySignalResult = {
  blocked: boolean;
  totalMatches: number;
  signals: Array<{
    signalId: string;
    observationCode: string;
    ruleId: string;
    severity: "BLOCK";
  }>;
};

export type RecordedIntegrityObservation =
  | {
      observationCode: IntegrityObservationCode;
      persisted: false;
      replayedIntoExisting: false;
      reason: "INFO";
    }
  | {
      observationCode: IntegrityObservationCode;
      persisted: true;
      replayedIntoExisting: boolean;
      signal: IntegritySignalDto;
    };

export type RecordedIntegrityDecision = {
  persisted: boolean;
  observations: RecordedIntegrityObservation[];
};

export type IntegrityReviewResult = {
  signal: IntegritySignalDto;
  reviewAction: IntegrityReviewActionDto;
};

export type IntegritySignalRecordInput = {
  envelope: import("../types.js").IntegrityActionEnvelope;
  decision: import("../types.js").IntegrityDecision;
};

export type IntegrityReviewInput = {
  signalId: string;
  reviewerUserId: string;
  action: IntegrityReviewActionType;
  expectedReviewVersion: number;
  note?: string;
};

export type PersistenceErrorCode =
  | "INVALID_INPUT"
  | "SIGNAL_NOT_FOUND"
  | "REVIEW_VERSION_CONFLICT"
  | "INVALID_TRANSITION"
  | "SIGNAL_IDENTITY_CONFLICT"
  | "OCCURRENCE_COUNT_OVERFLOW";

const PERSISTENCE_ERROR_STATUS: Record<PersistenceErrorCode, number> = {
  INVALID_INPUT: 400,
  SIGNAL_NOT_FOUND: 404,
  REVIEW_VERSION_CONFLICT: 409,
  INVALID_TRANSITION: 409,
  SIGNAL_IDENTITY_CONFLICT: 500,
  OCCURRENCE_COUNT_OVERFLOW: 409,
};

export class StudyIntegrityPersistenceError extends Error {
  readonly status: number;

  constructor(readonly code: PersistenceErrorCode, message: string) {
    super(message);
    this.name = "StudyIntegrityPersistenceError";
    this.status = PERSISTENCE_ERROR_STATUS[code];
  }
}