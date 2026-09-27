import { Prisma, type PrismaClient } from "@prisma/client";
import {
  RETENTION_MEMORY_LOOKBACK_DAYS,
  RETENTION_MEMORY_OUTCOME_WINDOW,
} from "./retentionConstants.js";
import type {
  FlashcardOutcome,
  ObjectiveOutcome,
} from "./types.js";
import type { LectureRetentionMemoryEvidence } from "./retentionTypes.js";

export type RetentionQueryClient = PrismaClient | Prisma.TransactionClient;

type RawObjectiveOutcome = {
  lectureId: string;
  sourceId: string;
  itemId: string;
  occurredAt: Date;
  correct: boolean;
  source: string;
};

type RawFlashcardOutcome = {
  lectureId: string;
  sourceId: string;
  itemId: string;
  occurredAt: Date;
  remembered: boolean;
  source: string;
};

export async function loadLectureRetentionMemoryEvidence(
  client: RetentionQueryClient,
  userId: string,
  lectureIds: readonly string[],
  asOf: Date,
): Promise<LectureRetentionMemoryEvidence[]> {
  const ids = [...new Set(lectureIds)];
  if (ids.length === 0) return [];
  if (!Number.isFinite(asOf.getTime())) {
    throw new TypeError("Retention evidence requires a valid asOf timestamp.");
  }

  const lectureList = Prisma.join(ids.map((id) => Prisma.sql`${id}`));
  const earliestAllowed = new Date(
    asOf.getTime() - RETENTION_MEMORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );

  const [objectiveRows, flashcardRows] = await Promise.all([
    client.$queryRaw<RawObjectiveOutcome[]>(Prisma.sql`
      WITH mcq_study AS (
        SELECT
          mcq."lectureId" AS "lectureId",
          event."id" AS "sourceId",
          event."mcqId" AS "itemId",
          event."receivedAt" AS "occurredAt",
          (event."payload"->>'correct' = 'true') AS "correct",
          'MCQ'::text AS "source",
          ROW_NUMBER() OVER (
            PARTITION BY mcq."lectureId"
            ORDER BY event."receivedAt" DESC, event."id" ASC
          ) AS "sourceRank"
        FROM "StudyEvent" AS event
        INNER JOIN "Mcq" AS mcq ON mcq."id" = event."mcqId"
        WHERE event."userId" = ${userId}
          AND mcq."lectureId" IN (${lectureList})
          AND event."eventType" = 'mcq_attempted'
          AND event."source" IN ('backend', 'offline_replay')
          AND event."evidenceClass" = 'SERVER_VALIDATED'
          AND event."privacyClass" = 'PRIVATE_STUDY'
          AND event."receivedAt" >= ${earliestAllowed}
          AND event."receivedAt" <= ${asOf}
          AND event."payload"->>'correct' IN ('true', 'false')
          AND (event."lectureId" IS NULL OR event."lectureId" = mcq."lectureId")
          AND mcq."correctAnswer" IN ('A', 'B', 'C', 'D')
          AND BTRIM(mcq."question") <> ''
          AND BTRIM(mcq."optionA") <> ''
          AND BTRIM(mcq."optionB") <> ''
          AND BTRIM(mcq."optionC") <> ''
          AND BTRIM(mcq."optionD") <> ''
      ),
      recall_mcq AS (
        SELECT
          attempt."lectureId" AS "lectureId",
          attempt."id" AS "sourceId",
          attempt."itemId" AS "itemId",
          attempt."answeredAt" AS "occurredAt",
          (attempt."outcome" = 'CORRECT') AS "correct",
          'RECALL'::text AS "source",
          ROW_NUMBER() OVER (
            PARTITION BY attempt."lectureId"
            ORDER BY attempt."answeredAt" DESC, attempt."id" ASC
          ) AS "sourceRank"
        FROM "RecallAttempt" AS attempt
        INNER JOIN "Mcq" AS mcq
          ON mcq."id" = attempt."itemId"
         AND mcq."lectureId" = attempt."lectureId"
        WHERE attempt."userId" = ${userId}
          AND attempt."lectureId" IN (${lectureList})
          AND attempt."itemType" = 'MCQ'
          AND attempt."status" = 'ANSWERED'
          AND attempt."evidenceClass" = 'SERVER_DERIVED'
          AND attempt."privacyClass" = 'PRIVATE_STUDY'
          AND attempt."answeredAt" IS NOT NULL
          AND attempt."answeredAt" >= ${earliestAllowed}
          AND attempt."answeredAt" <= ${asOf}
          AND attempt."outcome" IN ('CORRECT', 'INCORRECT')
          AND mcq."correctAnswer" IN ('A', 'B', 'C', 'D')
          AND BTRIM(mcq."question") <> ''
          AND BTRIM(mcq."optionA") <> ''
          AND BTRIM(mcq."optionB") <> ''
          AND BTRIM(mcq."optionC") <> ''
          AND BTRIM(mcq."optionD") <> ''
      ),
      combined AS (
        SELECT "lectureId", "sourceId", "itemId", "occurredAt", "correct", "source"
        FROM mcq_study
        WHERE "sourceRank" <= ${RETENTION_MEMORY_OUTCOME_WINDOW}
        UNION ALL
        SELECT "lectureId", "sourceId", "itemId", "occurredAt", "correct", "source"
        FROM recall_mcq
        WHERE "sourceRank" <= ${RETENTION_MEMORY_OUTCOME_WINDOW}
      ),
      deduplicated AS (
        SELECT
          combined.*,
          ROW_NUMBER() OVER (
            PARTITION BY "lectureId", "itemId", "occurredAt", "correct"
            ORDER BY CASE "source" WHEN 'RECALL' THEN 0 ELSE 1 END, "sourceId" ASC
          ) AS "duplicateRank"
        FROM combined
      ),
      recent AS (
        SELECT
          "lectureId", "sourceId", "itemId", "occurredAt", "correct", "source",
          ROW_NUMBER() OVER (
            PARTITION BY "lectureId"
            ORDER BY "occurredAt" DESC, "sourceId" ASC, "source" ASC, "itemId" ASC
          ) AS "windowRank"
        FROM deduplicated
        WHERE "duplicateRank" = 1
      )
      SELECT "lectureId", "sourceId", "itemId", "occurredAt", "correct", "source"
      FROM recent
      WHERE "windowRank" <= ${RETENTION_MEMORY_OUTCOME_WINDOW}
    `),
    client.$queryRaw<RawFlashcardOutcome[]>(Prisma.sql`
      WITH flashcard_study AS (
        SELECT
          flashcard."lectureId" AS "lectureId",
          event."id" AS "sourceId",
          event."flashcardId" AS "itemId",
          event."receivedAt" AS "occurredAt",
          (event."payload"->>'quality' <> 'AGAIN') AS "remembered",
          'FLASHCARD'::text AS "source",
          ROW_NUMBER() OVER (
            PARTITION BY flashcard."lectureId"
            ORDER BY event."receivedAt" DESC, event."id" ASC
          ) AS "sourceRank"
        FROM "StudyEvent" AS event
        INNER JOIN "Flashcard" AS flashcard
          ON flashcard."id" = event."flashcardId"
        WHERE event."userId" = ${userId}
          AND flashcard."lectureId" IN (${lectureList})
          AND event."eventType" = 'flashcard_reviewed'
          AND event."source" IN ('backend', 'offline_replay')
          AND event."evidenceClass" = 'SERVER_VALIDATED'
          AND event."privacyClass" = 'PRIVATE_STUDY'
          AND event."receivedAt" >= ${earliestAllowed}
          AND event."receivedAt" <= ${asOf}
          AND event."payload"->>'quality' IN ('AGAIN', 'HARD', 'GOOD', 'EASY')
          AND (event."lectureId" IS NULL OR event."lectureId" = flashcard."lectureId")
      ),
      recall_flashcards AS (
        SELECT
          attempt."lectureId" AS "lectureId",
          attempt."id" AS "sourceId",
          attempt."itemId" AS "itemId",
          attempt."answeredAt" AS "occurredAt",
          (attempt."outcome" = 'SELF_REPORTED_EASY') AS "remembered",
          'RECALL'::text AS "source",
          ROW_NUMBER() OVER (
            PARTITION BY attempt."lectureId"
            ORDER BY attempt."answeredAt" DESC, attempt."id" ASC
          ) AS "sourceRank"
        FROM "RecallAttempt" AS attempt
        INNER JOIN "Flashcard" AS flashcard
          ON flashcard."id" = attempt."itemId"
         AND flashcard."lectureId" = attempt."lectureId"
        WHERE attempt."userId" = ${userId}
          AND attempt."lectureId" IN (${lectureList})
          AND attempt."itemType" = 'FLASHCARD'
          AND attempt."status" = 'ANSWERED'
          AND attempt."evidenceClass" = 'CLIENT_OBSERVED'
          AND attempt."privacyClass" = 'PRIVATE_STUDY'
          AND attempt."answeredAt" IS NOT NULL
          AND attempt."answeredAt" >= ${earliestAllowed}
          AND attempt."answeredAt" <= ${asOf}
          AND attempt."outcome" IN ('SELF_REPORTED_HARD', 'SELF_REPORTED_EASY')
      ),
      combined AS (
        SELECT "lectureId", "sourceId", "itemId", "occurredAt", "remembered", "source"
        FROM flashcard_study
        WHERE "sourceRank" <= ${RETENTION_MEMORY_OUTCOME_WINDOW}
        UNION ALL
        SELECT "lectureId", "sourceId", "itemId", "occurredAt", "remembered", "source"
        FROM recall_flashcards
        WHERE "sourceRank" <= ${RETENTION_MEMORY_OUTCOME_WINDOW}
      ),
      deduplicated AS (
        SELECT
          combined.*,
          ROW_NUMBER() OVER (
            PARTITION BY "lectureId", "itemId", "occurredAt", "remembered"
            ORDER BY CASE "source" WHEN 'RECALL' THEN 0 ELSE 1 END, "sourceId" ASC
          ) AS "duplicateRank"
        FROM combined
      ),
      recent AS (
        SELECT
          "lectureId", "sourceId", "itemId", "occurredAt", "remembered", "source",
          ROW_NUMBER() OVER (
            PARTITION BY "lectureId"
            ORDER BY "occurredAt" DESC, "sourceId" ASC, "source" ASC, "itemId" ASC
          ) AS "windowRank"
        FROM deduplicated
        WHERE "duplicateRank" = 1
      )
      SELECT "lectureId", "sourceId", "itemId", "occurredAt", "remembered", "source"
      FROM recent
      WHERE "windowRank" <= ${RETENTION_MEMORY_OUTCOME_WINDOW}
    `),
  ]);

  const objectivesByLecture = groupBy(objectiveRows);
  const flashcardsByLecture = groupBy(flashcardRows);

  return ids.map((lectureId) => ({
    userId,
    lectureId,
    asOf: new Date(asOf.getTime()),
    objectiveOutcomes: (objectivesByLecture.get(lectureId) ?? [])
      .filter(validObjective)
      .map((row): ObjectiveOutcome => ({
        id: `RECALL_OR_MCQ:${row.sourceId}`,
        itemId: row.itemId,
        occurredAt: row.occurredAt,
        correct: row.correct,
        source: row.source === "RECALL" ? "RECALL" : "MCQ",
      })),
    flashcardOutcomes: (flashcardsByLecture.get(lectureId) ?? [])
      .filter(validFlashcard)
      .map((row): FlashcardOutcome => ({
        id: `RECALL_OR_FLASHCARD:${row.sourceId}`,
        itemId: row.itemId,
        occurredAt: row.occurredAt,
        remembered: row.remembered,
        source: row.source === "RECALL" ? "RECALL" : "FLASHCARD",
      })),
  }));
}

function groupBy<T extends { lectureId: string }>(
  rows: readonly T[],
): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const group = result.get(row.lectureId) ?? [];
    group.push(row);
    result.set(row.lectureId, group);
  }
  return result;
}

function validObjective(row: RawObjectiveOutcome): boolean {
  return Boolean(
    row.lectureId &&
      row.sourceId &&
      row.itemId &&
      row.occurredAt instanceof Date &&
      Number.isFinite(row.occurredAt.getTime()) &&
      typeof row.correct === "boolean" &&
      (row.source === "MCQ" || row.source === "RECALL"),
  );
}

function validFlashcard(row: RawFlashcardOutcome): boolean {
  return Boolean(
    row.lectureId &&
      row.sourceId &&
      row.itemId &&
      row.occurredAt instanceof Date &&
      Number.isFinite(row.occurredAt.getTime()) &&
      typeof row.remembered === "boolean" &&
      (row.source === "FLASHCARD" || row.source === "RECALL"),
  );
}