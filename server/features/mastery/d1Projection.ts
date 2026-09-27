import type { Prisma, PrismaClient } from "@prisma/client";
import { enqueuePrivateD1Projection } from "../../services/privateD1Sync.js";
import type { LectureMasteryProjection } from "./repository.js";
import type { LectureRetentionProjection } from "./retentionTypes.js";

type ProjectionExecutor = PrismaClient | Prisma.TransactionClient;

export function lectureMasteryD1Payload(
  row: LectureMasteryProjection,
  subjectId: string | null,
): Record<string, unknown> {
  return {
    user_id: row.userId, lecture_id: row.lectureId, subject_id: subjectId,
    state: row.state, evidence_score: row.evidenceScore, evidence_count: row.evidenceCount,
    objective_attempt_count: row.objectiveAttemptCount,
    objective_correct_count: row.objectiveCorrectCount,
    objective_incorrect_count: row.objectiveIncorrectCount,
    flashcard_review_count: row.flashcardReviewCount,
    flashcard_remembered_count: row.flashcardRememberedCount,
    flashcard_not_remembered_count: row.flashcardNotRememberedCount,
    recall_objective_attempt_count: row.recallObjectiveAttemptCount,
    recall_objective_correct_count: row.recallObjectiveCorrectCount,
    recall_objective_incorrect_count: row.recallObjectiveIncorrectCount,
    meaningful_focus_session_count: row.meaningfulFocusSessionCount,
    meaningful_focus_seconds: row.meaningfulFocusSeconds,
    last_study_evidence_at: row.lastStudyEvidenceAt,
    last_objective_evidence_at: row.lastObjectiveEvidenceAt,
    last_recall_evidence_at: row.lastRecallEvidenceAt,
    rule_version: row.ruleVersion, revision: row.revision,
    last_evaluated_at: row.lastEvaluatedAt, created_at: row.createdAt, updated_at: row.updatedAt,
  };
}

export function lectureRetentionD1Payload(
  row: LectureRetentionProjection,
): Record<string, unknown> {
  return {
    user_id: row.userId, lecture_id: row.lectureId,
    source_mastery_revision: row.sourceMasteryRevision,
    source_mastery_rule_version: row.sourceMasteryRuleVersion,
    effective_mastery_state: row.effectiveMasteryState,
    retention_score: row.retentionScore, review_state: row.reviewState,
    review_urgency_score: row.reviewUrgencyScore,
    retention_anchor_at: row.retentionAnchorAt, next_review_at: row.nextReviewAt,
    next_evaluation_at: row.nextEvaluationAt,
    last_positive_memory_evidence_at: row.lastPositiveMemoryEvidenceAt,
    last_negative_memory_evidence_at: row.lastNegativeMemoryEvidenceAt,
    last_forgetting_evidence_at: row.lastForgettingEvidenceAt,
    objective_forgetting_item_count: row.objectiveForgettingItemCount,
    self_reported_forgetting_item_count: row.selfReportedForgettingItemCount,
    forgetting_evidence_kind: row.forgettingEvidenceKind, rule_version: row.ruleVersion,
    revision: row.revision, last_evaluated_at: row.lastEvaluatedAt,
    created_at: row.createdAt, updated_at: row.updatedAt,
  };
}

export function masteryD1ProjectionEnabled(): boolean {
  const value = String(process.env.MASTERY_D1_PROJECTION_ENABLED || "")
    .trim()
    .toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export async function enqueueLectureMasteryD1Projection(
  executor: ProjectionExecutor,
  row: LectureMasteryProjection,
  subjectId: string | null,
): Promise<string> {
  return enqueuePrivateD1Projection(executor, {
    entity: "LectureMastery",
    key: { user_id: row.userId, lecture_id: row.lectureId },
    data: lectureMasteryD1Payload(row, subjectId),
  });
}

export async function enqueueLectureRetentionD1Projection(
  executor: ProjectionExecutor,
  row: LectureRetentionProjection,
): Promise<string> {
  return enqueuePrivateD1Projection(executor, {
    entity: "LectureRetention",
    key: { user_id: row.userId, lecture_id: row.lectureId },
    data: lectureRetentionD1Payload(row),
  });
}
