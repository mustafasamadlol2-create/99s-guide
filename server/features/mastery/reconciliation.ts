import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import {
  evaluateLectureMastery,
  readStoredLectureMastery,
  refreshLectureMastery,
} from "./refresh.js";
import type { LectureMasteryProjection } from "./repository.js";
import type { LectureMasteryEvaluation } from "./types.js";

export const LECTURE_MASTERY_RECONCILIATION_STATUSES = [
  "IN_SYNC",
  "MASTERY_MISSING",
  "STATE_MISMATCH",
  "EVIDENCE_SCORE_MISMATCH",
  "EVIDENCE_COUNT_MISMATCH",
  "SOURCE_SUMMARY_MISMATCH",
  "RULE_VERSION_STALE",
] as const;

export type LectureMasteryReconciliationStatus =
  (typeof LECTURE_MASTERY_RECONCILIATION_STATUSES)[number];

export type LectureMasteryReconciliation = {
  status: LectureMasteryReconciliationStatus;
  mismatches: LectureMasteryReconciliationStatus[];
  repaired: boolean;
  stored: LectureMasteryProjection | null;
  computed: LectureMasteryEvaluation;
};

export async function reconcileLectureMastery(input: {
  userId: string;
  lectureId: string;
  repair?: boolean;
  asOf?: Date;
  database?: PrismaClient;
}): Promise<LectureMasteryReconciliation> {
  const database = input.database ?? getPrisma();
  const asOf = input.asOf ?? new Date();
  const repaired = input.repair === true;

  if (repaired) {
    await refreshLectureMastery({
      userId: input.userId,
      lectureId: input.lectureId,
      asOf,
    });
  }

  const [computed, stored] = await Promise.all([
    evaluateLectureMastery({
      userId: input.userId,
      lectureId: input.lectureId,
      asOf,
    }),
    readStoredLectureMastery(
      input.userId,
      input.lectureId,
      database,
    ),
  ]);

  const mismatches = compareMasteryProjection(stored, computed);
  return {
    status: mismatches[0] ?? "IN_SYNC",
    mismatches,
    repaired,
    stored,
    computed,
  };
}

export function compareMasteryProjection(
  stored: LectureMasteryProjection | null,
  computed: LectureMasteryEvaluation,
): LectureMasteryReconciliationStatus[] {
  if (!stored) return ["MASTERY_MISSING"];

  const mismatches: LectureMasteryReconciliationStatus[] = [];
  if (stored.ruleVersion !== computed.ruleVersion) {
    mismatches.push("RULE_VERSION_STALE");
  }
  if (stored.state !== computed.state) {
    mismatches.push("STATE_MISMATCH");
  }
  if (stored.evidenceScore !== computed.evidenceScore) {
    mismatches.push("EVIDENCE_SCORE_MISMATCH");
  }
  if (stored.evidenceCount !== computed.evidenceCount) {
    mismatches.push("EVIDENCE_COUNT_MISMATCH");
  }
  if (sourceSummaryDiffers(stored, computed)) {
    mismatches.push("SOURCE_SUMMARY_MISMATCH");
  }
  return mismatches;
}

function sourceSummaryDiffers(
  stored: LectureMasteryProjection,
  computed: LectureMasteryEvaluation,
): boolean {
  const countFields = [
    "objectiveAttemptCount",
    "objectiveCorrectCount",
    "objectiveIncorrectCount",
    "flashcardReviewCount",
    "flashcardRememberedCount",
    "flashcardNotRememberedCount",
    "recallObjectiveAttemptCount",
    "recallObjectiveCorrectCount",
    "recallObjectiveIncorrectCount",
    "meaningfulFocusSessionCount",
    "meaningfulFocusSeconds",
  ] as const;
  if (countFields.some((key) => stored[key] !== computed[key])) return true;
  const timestampFields = [
    "lastStudyEvidenceAt",
    "lastObjectiveEvidenceAt",
    "lastRecallEvidenceAt",
  ] as const;
  return timestampFields.some((key) => !sameDate(stored[key], computed[key]));
}

function sameDate(left: Date | null, right: Date | null): boolean {
  return left === null
    ? right === null
    : right instanceof Date && left.getTime() === right.getTime();
}