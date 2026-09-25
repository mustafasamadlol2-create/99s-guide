import type {
  IntegrityReviewAction as DbIntegrityReviewAction,
  IntegritySignal as DbIntegritySignal,
} from "@prisma/client";
import type {
  IntegrityReviewActionDto,
  IntegritySignalDto,
} from "./types.js";

export function toIntegritySignalDto(
  signal: DbIntegritySignal,
): IntegritySignalDto {
  return {
    id: signal.id,
    userId: signal.userId,
    actionType: signal.actionType,
    observationCode: signal.observationCode,
    category: signal.category,
    severity: signal.severity,
    ruleId: signal.ruleId,
    ruleVersion: signal.ruleVersion,
    evidenceClass: signal.evidenceClass,
    source: signal.source,
    privacyClass: signal.privacyClass,
    resourceKind: signal.resourceKind,
    resourceId: signal.resourceId,
    firstOccurredAt: signal.firstOccurredAt,
    lastOccurredAt: signal.lastOccurredAt,
    lastReceivedAt: signal.lastReceivedAt,
    occurrenceCount: signal.occurrenceCount,
    status: signal.status,
    reviewVersion: signal.reviewVersion,
    latestSafeDetails: signal.latestSafeDetails,
    createdAt: signal.createdAt,
    updatedAt: signal.updatedAt,
    resolvedAt: signal.resolvedAt,
  };
}

export function toIntegrityReviewActionDto(
  action: DbIntegrityReviewAction,
): IntegrityReviewActionDto {
  return {
    id: action.id,
    signalId: action.signalId,
    reviewerUserId: action.reviewerUserId,
    fromStatus: action.fromStatus,
    toStatus: action.toStatus,
    actionType: action.actionType,
    note: action.note,
    createdAt: action.createdAt,
  };
}