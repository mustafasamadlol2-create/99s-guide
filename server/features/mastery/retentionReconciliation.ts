import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { refreshLectureMastery, readStoredLectureMastery } from "./refresh.js";
import { loadLectureRetentionMemoryEvidence } from "./retentionEvidence.js";
import { evaluateLectureRetention } from "./retentionEvaluator.js";
import {
  findLectureRetention,
  sameDate,
  writeLectureRetentionProjection,
} from "./retentionRepository.js";
import { LectureMasteryError } from "./errors.js";
import { RETENTION_RULE_VERSION } from "./retentionConstants.js";
import type {
  LectureRetentionEvaluation,
  LectureRetentionProjection,
} from "./retentionTypes.js";
import { reconcileLectureMastery } from "./reconciliation.js";

export const LECTURE_RETENTION_RECONCILIATION_STATUSES = [
  "IN_SYNC",
  "RETENTION_MISSING",
  "SOURCE_MASTERY_STALE",
  "RULE_VERSION_STALE",
  "EFFECTIVE_MASTERY_MISMATCH",
  "RETENTION_SCORE_MISMATCH",
  "REVIEW_STATE_MISMATCH",
  "REVIEW_URGENCY_MISMATCH",
  "ANCHOR_MISMATCH",
  "NEXT_REVIEW_MISMATCH",
  "NEXT_EVALUATION_MISMATCH",
  "MEMORY_EVIDENCE_SUMMARY_MISMATCH",
] as const;

export type LectureRetentionReconciliationStatus =
  (typeof LECTURE_RETENTION_RECONCILIATION_STATUSES)[number];

export type LectureRetentionReconciliation = {
  status: LectureRetentionReconciliationStatus;
  mismatches: LectureRetentionReconciliationStatus[];
  repaired: boolean;
  stored: LectureRetentionProjection | null;
  computed: LectureRetentionEvaluation;
};

export async function reconcileLectureRetention(input: {
  userId: string;
  lectureId: string;
  repair?: boolean;
  asOf?: Date;
  database?: PrismaClient;
}): Promise<LectureRetentionReconciliation> {
  if (
    typeof input.userId !== "string" ||
    input.userId.length === 0 ||
    typeof input.lectureId !== "string" ||
    input.lectureId.length === 0
  ) {
    throw new LectureMasteryError(
      "INVALID_INPUT",
      "Retention user and lecture IDs must be nonempty strings.",
    );
  }
  const database = input.database ?? getPrisma();
  const asOf = input.asOf ? new Date(input.asOf.getTime()) : new Date();
  if (!Number.isFinite(asOf.getTime())) {
    throw new LectureMasteryError(
      "INVALID_INPUT",
      "Retention reconciliation asOf timestamp is invalid.",
    );
  }

  let masteryReconciliation = await reconcileLectureMastery({
    userId: input.userId,
    lectureId: input.lectureId,
    asOf,
    database,
  });
  let repaired = false;

  if (input.repair && masteryReconciliation.mismatches.length > 0) {
    const masteryRefresh = await refreshLectureMastery({
      userId: input.userId,
      lectureId: input.lectureId,
      asOf,
    });
    repaired = masteryRefresh.changed;
    masteryReconciliation = await reconcileLectureMastery({
      userId: input.userId,
      lectureId: input.lectureId,
      asOf,
      database,
    });
  }

  const storedMastery = await readStoredLectureMastery(
    input.userId,
    input.lectureId,
    database,
  );
  const masterySource = storedMastery ?? {
    userId: input.userId,
    lectureId: input.lectureId,
    state: masteryReconciliation.computed.state,
    evidenceScore: masteryReconciliation.computed.evidenceScore,
    revision: 0,
    ruleVersion: masteryReconciliation.computed.ruleVersion,
  };
  const [memoryEvidence, storedRetention] = await Promise.all([
    loadLectureRetentionMemoryEvidence(
      database,
      input.userId,
      [input.lectureId],
      asOf,
    ),
    findLectureRetention(database, input.userId, input.lectureId),
  ]);
  const evidence = memoryEvidence[0];
  if (!evidence) {
    throw new Error("Retention evidence loader omitted the requested lecture.");
  }
  const computed = evaluateLectureRetention({
    mastery: masterySource,
    memoryEvidence: evidence,
    asOf,
  });
  let finalStoredRetention = storedRetention;
  let mismatches = compareRetentionProjection(
    finalStoredRetention,
    computed,
    masteryReconciliation.mismatches.length > 0 ||
      storedMastery === null,
  );

  if (input.repair && mismatches.length > 0) {
    const write = await database.$transaction((tx) =>
      writeLectureRetentionProjection(tx, computed, asOf, storedRetention),
    );
    repaired = repaired || write.changed;
    finalStoredRetention = write.row;
    mismatches = compareRetentionProjection(
      finalStoredRetention,
      computed,
      masteryReconciliation.mismatches.length > 0 ||
        storedMastery === null,
    );
  }

  return {
    status: mismatches[0] ?? "IN_SYNC",
    mismatches,
    repaired,
    stored: finalStoredRetention,
    computed,
  };
}

export function compareRetentionProjection(
  stored: LectureRetentionProjection | null,
  computed: LectureRetentionEvaluation,
  sourceMasteryStale: boolean,
): LectureRetentionReconciliationStatus[] {
  const mismatches: LectureRetentionReconciliationStatus[] = [];
  if (!stored) {
    mismatches.push("RETENTION_MISSING");
  } else {
    if (
      stored.sourceMasteryRevision !== computed.sourceMasteryRevision ||
      stored.sourceMasteryRuleVersion !== computed.sourceMasteryRuleVersion
    ) {
      mismatches.push("SOURCE_MASTERY_STALE");
    }
    if (
      stored.ruleVersion !== RETENTION_RULE_VERSION ||
      stored.ruleVersion !== computed.ruleVersion
    ) {
      mismatches.push("RULE_VERSION_STALE");
    }
    if (stored.effectiveMasteryState !== computed.effectiveMasteryState) {
      mismatches.push("EFFECTIVE_MASTERY_MISMATCH");
    }
    if (stored.retentionScore !== computed.retentionScore) {
      mismatches.push("RETENTION_SCORE_MISMATCH");
    }
    if (stored.reviewState !== computed.reviewState) {
      mismatches.push("REVIEW_STATE_MISMATCH");
    }
    if (stored.reviewUrgencyScore !== computed.reviewUrgencyScore) {
      mismatches.push("REVIEW_URGENCY_MISMATCH");
    }
    if (
      !sameDate(stored.retentionAnchorAt, computed.retentionAnchorAt) ||
      !sameDate(stored.lastPositiveMemoryEvidenceAt, computed.lastPositiveMemoryEvidenceAt) ||
      !sameDate(stored.lastNegativeMemoryEvidenceAt, computed.lastNegativeMemoryEvidenceAt) ||
      !sameDate(stored.lastForgettingEvidenceAt, computed.lastForgettingEvidenceAt) ||
      stored.objectiveForgettingItemCount !==
        computed.objectiveForgettingItemCount ||
      stored.selfReportedForgettingItemCount !==
        computed.selfReportedForgettingItemCount ||
      stored.forgettingEvidenceKind !== computed.forgettingEvidenceKind
    ) {
      mismatches.push("MEMORY_EVIDENCE_SUMMARY_MISMATCH");
    }
    if (!sameDate(stored.nextReviewAt, computed.nextReviewAt)) {
      mismatches.push("NEXT_REVIEW_MISMATCH");
    }
    if (!sameDate(stored.nextEvaluationAt, computed.nextEvaluationAt)) {
      mismatches.push("NEXT_EVALUATION_MISMATCH");
    }
  }

  if (sourceMasteryStale && !mismatches.includes("SOURCE_MASTERY_STALE")) {
    mismatches.push("SOURCE_MASTERY_STALE");
  }
  return mismatches;
}