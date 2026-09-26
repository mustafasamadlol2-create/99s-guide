import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { MasteryState } from "../study-core/constants.js";
import type { LectureMasteryEvaluation } from "./types.js";

export type MasteryRepositoryClient = PrismaClient | Prisma.TransactionClient;

export type LectureMasteryProjection = {
  id: string;
  userId: string;
  lectureId: string;
  state: MasteryState;
  evidenceScore: number;
  evidenceCount: number;
  objectiveAttemptCount: number;
  objectiveCorrectCount: number;
  objectiveIncorrectCount: number;
  flashcardReviewCount: number;
  flashcardRememberedCount: number;
  flashcardNotRememberedCount: number;
  recallObjectiveAttemptCount: number;
  recallObjectiveCorrectCount: number;
  recallObjectiveIncorrectCount: number;
  meaningfulFocusSessionCount: number;
  meaningfulFocusSeconds: number;
  lastStudyEvidenceAt: Date | null;
  lastObjectiveEvidenceAt: Date | null;
  lastRecallEvidenceAt: Date | null;
  ruleVersion: string;
  revision: number;
  lastEvaluatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export async function findLectureMastery(
  client: MasteryRepositoryClient,
  userId: string,
  lectureId: string,
): Promise<LectureMasteryProjection | null> {
  return client.lectureMastery.findUnique({
    where: { userId_lectureId: { userId, lectureId } },
  }) as Promise<LectureMasteryProjection | null>;
}

export async function writeLectureMasteryProjection(
  client: MasteryRepositoryClient,
  evaluation: LectureMasteryEvaluation,
  asOf: Date,
): Promise<{ row: LectureMasteryProjection; changed: boolean }> {
  const values = {
    state: evaluation.state,
    evidenceScore: evaluation.evidenceScore,
    evidenceCount: evaluation.evidenceCount,
    objectiveAttemptCount: evaluation.objectiveAttemptCount,
    objectiveCorrectCount: evaluation.objectiveCorrectCount,
    objectiveIncorrectCount: evaluation.objectiveIncorrectCount,
    flashcardReviewCount: evaluation.flashcardReviewCount,
    flashcardRememberedCount: evaluation.flashcardRememberedCount,
    flashcardNotRememberedCount: evaluation.flashcardNotRememberedCount,
    recallObjectiveAttemptCount: evaluation.recallObjectiveAttemptCount,
    recallObjectiveCorrectCount: evaluation.recallObjectiveCorrectCount,
    recallObjectiveIncorrectCount: evaluation.recallObjectiveIncorrectCount,
    meaningfulFocusSessionCount: evaluation.meaningfulFocusSessionCount,
    meaningfulFocusSeconds: evaluation.meaningfulFocusSeconds,
    lastStudyEvidenceAt: evaluation.lastStudyEvidenceAt,
    lastObjectiveEvidenceAt: evaluation.lastObjectiveEvidenceAt,
    lastRecallEvidenceAt: evaluation.lastRecallEvidenceAt,
    ruleVersion: evaluation.ruleVersion,
  };

  const changedRows = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO "LectureMastery" (
      "id",
      "userId",
      "lectureId",
      "state",
      "evidenceScore",
      "evidenceCount",
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
      "lastStudyEvidenceAt",
      "lastObjectiveEvidenceAt",
      "lastRecallEvidenceAt",
      "ruleVersion",
      "revision",
      "lastEvaluatedAt",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${randomUUID()},
      ${evaluation.userId},
      ${evaluation.lectureId},
      ${evaluation.state}::"LectureMasteryState",
      ${values.evidenceScore},
      ${values.evidenceCount},
      ${values.objectiveAttemptCount},
      ${values.objectiveCorrectCount},
      ${values.objectiveIncorrectCount},
      ${values.flashcardReviewCount},
      ${values.flashcardRememberedCount},
      ${values.flashcardNotRememberedCount},
      ${values.recallObjectiveAttemptCount},
      ${values.recallObjectiveCorrectCount},
      ${values.recallObjectiveIncorrectCount},
      ${values.meaningfulFocusSessionCount},
      ${values.meaningfulFocusSeconds},
      ${values.lastStudyEvidenceAt},
      ${values.lastObjectiveEvidenceAt},
      ${values.lastRecallEvidenceAt},
      ${values.ruleVersion},
      1,
      ${asOf},
      ${asOf},
      ${asOf}
    )
    ON CONFLICT ("userId", "lectureId") DO UPDATE SET
      "state" = EXCLUDED."state",
      "evidenceScore" = EXCLUDED."evidenceScore",
      "evidenceCount" = EXCLUDED."evidenceCount",
      "objectiveAttemptCount" = EXCLUDED."objectiveAttemptCount",
      "objectiveCorrectCount" = EXCLUDED."objectiveCorrectCount",
      "objectiveIncorrectCount" = EXCLUDED."objectiveIncorrectCount",
      "flashcardReviewCount" = EXCLUDED."flashcardReviewCount",
      "flashcardRememberedCount" = EXCLUDED."flashcardRememberedCount",
      "flashcardNotRememberedCount" = EXCLUDED."flashcardNotRememberedCount",
      "recallObjectiveAttemptCount" = EXCLUDED."recallObjectiveAttemptCount",
      "recallObjectiveCorrectCount" = EXCLUDED."recallObjectiveCorrectCount",
      "recallObjectiveIncorrectCount" = EXCLUDED."recallObjectiveIncorrectCount",
      "meaningfulFocusSessionCount" = EXCLUDED."meaningfulFocusSessionCount",
      "meaningfulFocusSeconds" = EXCLUDED."meaningfulFocusSeconds",
      "lastStudyEvidenceAt" = EXCLUDED."lastStudyEvidenceAt",
      "lastObjectiveEvidenceAt" = EXCLUDED."lastObjectiveEvidenceAt",
      "lastRecallEvidenceAt" = EXCLUDED."lastRecallEvidenceAt",
      "ruleVersion" = EXCLUDED."ruleVersion",
      "revision" = "LectureMastery"."revision" + 1,
      "lastEvaluatedAt" = EXCLUDED."lastEvaluatedAt",
      "updatedAt" = EXCLUDED."updatedAt"
    WHERE EXCLUDED."lastEvaluatedAt" >= "LectureMastery"."lastEvaluatedAt"
      AND (
        "LectureMastery"."state" IS DISTINCT FROM EXCLUDED."state"
        OR "LectureMastery"."evidenceScore" IS DISTINCT FROM EXCLUDED."evidenceScore"
        OR "LectureMastery"."evidenceCount" IS DISTINCT FROM EXCLUDED."evidenceCount"
        OR "LectureMastery"."objectiveAttemptCount" IS DISTINCT FROM EXCLUDED."objectiveAttemptCount"
        OR "LectureMastery"."objectiveCorrectCount" IS DISTINCT FROM EXCLUDED."objectiveCorrectCount"
        OR "LectureMastery"."objectiveIncorrectCount" IS DISTINCT FROM EXCLUDED."objectiveIncorrectCount"
        OR "LectureMastery"."flashcardReviewCount" IS DISTINCT FROM EXCLUDED."flashcardReviewCount"
        OR "LectureMastery"."flashcardRememberedCount" IS DISTINCT FROM EXCLUDED."flashcardRememberedCount"
        OR "LectureMastery"."flashcardNotRememberedCount" IS DISTINCT FROM EXCLUDED."flashcardNotRememberedCount"
        OR "LectureMastery"."recallObjectiveAttemptCount" IS DISTINCT FROM EXCLUDED."recallObjectiveAttemptCount"
        OR "LectureMastery"."recallObjectiveCorrectCount" IS DISTINCT FROM EXCLUDED."recallObjectiveCorrectCount"
        OR "LectureMastery"."recallObjectiveIncorrectCount" IS DISTINCT FROM EXCLUDED."recallObjectiveIncorrectCount"
        OR "LectureMastery"."meaningfulFocusSessionCount" IS DISTINCT FROM EXCLUDED."meaningfulFocusSessionCount"
        OR "LectureMastery"."meaningfulFocusSeconds" IS DISTINCT FROM EXCLUDED."meaningfulFocusSeconds"
        OR "LectureMastery"."lastStudyEvidenceAt" IS DISTINCT FROM EXCLUDED."lastStudyEvidenceAt"
        OR "LectureMastery"."lastObjectiveEvidenceAt" IS DISTINCT FROM EXCLUDED."lastObjectiveEvidenceAt"
        OR "LectureMastery"."lastRecallEvidenceAt" IS DISTINCT FROM EXCLUDED."lastRecallEvidenceAt"
        OR "LectureMastery"."ruleVersion" IS DISTINCT FROM EXCLUDED."ruleVersion"
      )
    RETURNING "id"
  `);
  const row = await findLectureMastery(
    client,
    evaluation.userId,
    evaluation.lectureId,
  );
  if (!row) {
    throw new Error("LectureMastery upsert completed without a projection row.");
  }
  return { row, changed: changedRows.length > 0 };
}