import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  LectureRetentionEvaluation,
  LectureRetentionProjection,
} from "./retentionTypes.js";
import type { RetentionQueryClient } from "./retentionEvidence.js";

export type RetentionRepositoryClient = PrismaClient | Prisma.TransactionClient;

export async function findLectureRetention(
  client: RetentionRepositoryClient,
  userId: string,
  lectureId: string,
): Promise<LectureRetentionProjection | null> {
  return client.lectureRetention.findUnique({
    where: { userId_lectureId: { userId, lectureId } },
  });
}

export async function findUserLectureRetention(
  client: RetentionRepositoryClient,
  userId: string,
  lectureIds: readonly string[],
): Promise<LectureRetentionProjection[]> {
  if (lectureIds.length === 0) return [];
  return client.lectureRetention.findMany({
    where: { userId, lectureId: { in: [...lectureIds] } },
  });
}

export async function writeLectureRetentionProjection(
  client: RetentionRepositoryClient,
  evaluation: LectureRetentionEvaluation,
  asOf: Date,
  existing?: LectureRetentionProjection | null,
): Promise<{ row: LectureRetentionProjection; changed: boolean }> {
  const current =
    existing === undefined
      ? await findLectureRetention(client, evaluation.userId, evaluation.lectureId)
      : existing;
  const data = evaluationData(evaluation);
  if (current && projectionMatches(current, evaluation)) {
    return { row: current, changed: false };
  }

  const row = await client.lectureRetention.upsert({
    where: {
      userId_lectureId: {
        userId: evaluation.userId,
        lectureId: evaluation.lectureId,
      },
    },
    create: {
      ...data,
      lastEvaluatedAt: asOf,
    },
    update: {
      ...data,
      revision: { increment: 1 },
      lastEvaluatedAt: asOf,
    },
  });
  return { row, changed: true };
}

export function projectionMatches(
  stored: LectureRetentionProjection,
  computed: LectureRetentionEvaluation,
): boolean {
  const scalarFields = [
    "sourceMasteryRevision",
    "sourceMasteryRuleVersion",
    "effectiveMasteryState",
    "retentionScore",
    "reviewState",
    "reviewUrgencyScore",
    "objectiveForgettingItemCount",
    "selfReportedForgettingItemCount",
    "forgettingEvidenceKind",
    "ruleVersion",
  ] as const;
  if (scalarFields.some((field) => stored[field] !== computed[field])) {
    return false;
  }

  const dateFields = [
    "retentionAnchorAt",
    "nextReviewAt",
    "nextEvaluationAt",
    "lastPositiveMemoryEvidenceAt",
    "lastNegativeMemoryEvidenceAt",
    "lastForgettingEvidenceAt",
  ] as const;
  return dateFields.every((field) => sameDate(stored[field], computed[field]));
}

export function sameDate(
  left: Date | null,
  right: Date | null,
): boolean {
  return left === null
    ? right === null
    : right instanceof Date && left.getTime() === right.getTime();
}

function evaluationData(
  evaluation: LectureRetentionEvaluation,
): Prisma.LectureRetentionUncheckedCreateInput {
  return {
    userId: evaluation.userId,
    lectureId: evaluation.lectureId,
    sourceMasteryRevision: evaluation.sourceMasteryRevision,
    sourceMasteryRuleVersion: evaluation.sourceMasteryRuleVersion,
    effectiveMasteryState: evaluation.effectiveMasteryState,
    retentionScore: evaluation.retentionScore,
    reviewState: evaluation.reviewState,
    reviewUrgencyScore: evaluation.reviewUrgencyScore,
    retentionAnchorAt: evaluation.retentionAnchorAt,
    nextReviewAt: evaluation.nextReviewAt,
    nextEvaluationAt: evaluation.nextEvaluationAt,
    lastPositiveMemoryEvidenceAt: evaluation.lastPositiveMemoryEvidenceAt,
    lastNegativeMemoryEvidenceAt: evaluation.lastNegativeMemoryEvidenceAt,
    lastForgettingEvidenceAt: evaluation.lastForgettingEvidenceAt,
    objectiveForgettingItemCount: evaluation.objectiveForgettingItemCount,
    selfReportedForgettingItemCount: evaluation.selfReportedForgettingItemCount,
    forgettingEvidenceKind: evaluation.forgettingEvidenceKind,
    ruleVersion: evaluation.ruleVersion,
  };
}