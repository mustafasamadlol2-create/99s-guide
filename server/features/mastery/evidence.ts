import { Prisma, type PrismaClient } from "@prisma/client";
import {
  MASTERY_FLASHCARD_WINDOW,
  MASTERY_MEANINGFUL_FOCUS_SECONDS,
  MASTERY_OBJECTIVE_WINDOW,
  MASTERY_STUDY_WINDOW_DAYS,
} from "./constants.js";
import type {
  FlashcardOutcome,
  LectureMasteryEvidence,
  ObjectiveOutcome,
} from "./types.js";

export type MasteryQueryClient = PrismaClient | Prisma.TransactionClient;

type RawObjectiveOutcome = {
  lectureId: string;
  sourceId: string;
  itemId: string;
  occurredAt: Date;
  correct: boolean;
  source: "MCQ" | "RECALL";
};

type RawFlashcardOutcome = {
  lectureId: string;
  sourceId: string;
  itemId: string;
  occurredAt: Date;
  remembered: boolean;
  source: "FLASHCARD" | "RECALL";
};

type RawInventoryCount = {
  lectureId: string;
  itemCount: number | bigint;
};

type RawStudyStats = {
  lectureId: string;
  recentSessionCount: number | bigint;
  recentSeconds: number | bigint;
  lastStudyEvidenceAt: Date | null;
};

type RawRecallTimestamp = {
  lectureId: string;
  lastRecallEvidenceAt: Date | null;
};

export async function loadLectureMasteryEvidence(
  client: MasteryQueryClient,
  userId: string,
  lectureIds: readonly string[],
  asOf: Date,
): Promise<LectureMasteryEvidence[]> {
  const ids = [...new Set(lectureIds)];
  if (ids.length === 0) return [];
  if (!Number.isFinite(asOf.getTime())) {
    throw new TypeError("Mastery evidence requires a valid asOf timestamp.");
  }

  const lectureList = Prisma.join(ids.map((id) => Prisma.sql`${id}`));
  const focusCutoff = new Date(
    asOf.getTime() - MASTERY_STUDY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  const [
    objectiveRows,
    flashcardRows,
    inventoryRows,
    focusRows,
    groupFocusRows,
    recallTimestampRows,
  ] = await Promise.all([
    client.$queryRaw<RawObjectiveOutcome[]>(Prisma.sql`
      WITH study_events AS (
        SELECT
          COALESCE(event."lectureId", mcq."lectureId") AS "lectureId",
          event."id" AS "sourceId",
          event."mcqId" AS "itemId",
          event."receivedAt" AS "occurredAt",
          (event."payload"->>'correct' = 'true') AS "correct",
          'MCQ'::text AS "source",
          ROW_NUMBER() OVER (
            PARTITION BY mcq."lectureId"
            ORDER BY event."receivedAt" DESC, event."id" DESC
          ) AS "sourceRank"
        FROM "StudyEvent" AS event
        INNER JOIN "Mcq" AS mcq ON mcq."id" = event."mcqId"
        WHERE event."userId" = ${userId}
          AND mcq."lectureId" IN (${lectureList})
          AND event."eventType" = 'mcq_attempted'
          AND event."source" IN ('backend', 'offline_replay')
          AND event."evidenceClass" = 'SERVER_VALIDATED'
          AND event."privacyClass" = 'PRIVATE_STUDY'
          AND event."receivedAt" <= ${asOf}
          AND event."payload"->>'correct' IN ('true', 'false')
          AND (event."lectureId" IS NULL OR event."lectureId" = mcq."lectureId")
      ),
      bounded_study_events AS (
        SELECT "lectureId", "sourceId", "itemId", "occurredAt", "correct", "source"
        FROM study_events
        WHERE "sourceRank" <= ${MASTERY_OBJECTIVE_WINDOW}
      ),
      recall_attempts AS (
        SELECT
          attempt."lectureId",
          attempt."id" AS "sourceId",
          attempt."itemId",
          attempt."answeredAt" AS "occurredAt",
          (attempt."outcome" = 'CORRECT') AS "correct",
          'RECALL'::text AS "source",
          ROW_NUMBER() OVER (
            PARTITION BY attempt."lectureId"
            ORDER BY attempt."answeredAt" DESC, attempt."id" DESC
          ) AS "sourceRank"
        FROM "RecallAttempt" AS attempt
        WHERE attempt."userId" = ${userId}
          AND attempt."lectureId" IN (${lectureList})
          AND attempt."itemType" = 'MCQ'
          AND attempt."status" = 'ANSWERED'
          AND attempt."evidenceClass" = 'SERVER_DERIVED'
          AND attempt."privacyClass" = 'PRIVATE_STUDY'
          AND attempt."answeredAt" IS NOT NULL
          AND attempt."answeredAt" <= ${asOf}
          AND attempt."outcome" IN ('CORRECT', 'INCORRECT')
      ),
      bounded_recall_attempts AS (
        SELECT "lectureId", "sourceId", "itemId", "occurredAt", "correct", "source"
        FROM recall_attempts
        WHERE "sourceRank" <= ${MASTERY_OBJECTIVE_WINDOW}
      ),
      combined AS (
        SELECT * FROM bounded_study_events
        UNION ALL
        SELECT * FROM bounded_recall_attempts
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
            ORDER BY "occurredAt" DESC, "sourceId" DESC, "source" ASC
          ) AS "windowRank"
        FROM deduplicated
        WHERE "duplicateRank" = 1
      )
      SELECT "lectureId", "sourceId", "itemId", "occurredAt", "correct", "source"
      FROM recent
      WHERE "windowRank" <= ${MASTERY_OBJECTIVE_WINDOW}
    `),
    client.$queryRaw<RawFlashcardOutcome[]>(Prisma.sql`
      WITH study_events AS (
        SELECT
          COALESCE(event."lectureId", flashcard."lectureId") AS "lectureId",
          event."id" AS "sourceId",
          event."flashcardId" AS "itemId",
          event."receivedAt" AS "occurredAt",
          (event."payload"->>'quality' <> 'AGAIN') AS "remembered",
          'FLASHCARD'::text AS "source",
          ROW_NUMBER() OVER (
            PARTITION BY flashcard."lectureId"
            ORDER BY event."receivedAt" DESC, event."id" DESC
          ) AS "sourceRank"
        FROM "StudyEvent" AS event
        INNER JOIN "Flashcard" AS flashcard ON flashcard."id" = event."flashcardId"
        WHERE event."userId" = ${userId}
          AND flashcard."lectureId" IN (${lectureList})
          AND event."eventType" = 'flashcard_reviewed'
          AND event."source" IN ('backend', 'offline_replay')
          AND event."evidenceClass" = 'SERVER_VALIDATED'
          AND event."privacyClass" = 'PRIVATE_STUDY'
          AND event."receivedAt" <= ${asOf}
          AND event."payload"->>'quality' IN ('AGAIN', 'HARD', 'GOOD', 'EASY')
          AND (event."lectureId" IS NULL OR event."lectureId" = flashcard."lectureId")
      ),
      bounded_study_events AS (
        SELECT "lectureId", "sourceId", "itemId", "occurredAt", "remembered", "source"
        FROM study_events
        WHERE "sourceRank" <= ${MASTERY_FLASHCARD_WINDOW}
      ),
      recall_attempts AS (
        SELECT
          attempt."lectureId",
          attempt."id" AS "sourceId",
          attempt."itemId",
          attempt."answeredAt" AS "occurredAt",
          (attempt."outcome" = 'SELF_REPORTED_EASY') AS "remembered",
          'RECALL'::text AS "source",
          ROW_NUMBER() OVER (
            PARTITION BY attempt."lectureId"
            ORDER BY attempt."answeredAt" DESC, attempt."id" DESC
          ) AS "sourceRank"
        FROM "RecallAttempt" AS attempt
        WHERE attempt."userId" = ${userId}
          AND attempt."lectureId" IN (${lectureList})
          AND attempt."itemType" = 'FLASHCARD'
          AND attempt."status" = 'ANSWERED'
          AND attempt."evidenceClass" = 'CLIENT_OBSERVED'
          AND attempt."privacyClass" = 'PRIVATE_STUDY'
          AND attempt."answeredAt" IS NOT NULL
          AND attempt."answeredAt" <= ${asOf}
          AND attempt."outcome" IN (
            'SELF_REPORTED_HARD',
            'SELF_REPORTED_EASY'
          )
      ),
      bounded_recall_attempts AS (
        SELECT "lectureId", "sourceId", "itemId", "occurredAt", "remembered", "source"
        FROM recall_attempts
        WHERE "sourceRank" <= ${MASTERY_FLASHCARD_WINDOW}
      ),
      combined AS (
        SELECT * FROM bounded_study_events
        UNION ALL
        SELECT * FROM bounded_recall_attempts
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
            ORDER BY "occurredAt" DESC, "sourceId" DESC, "source" ASC
          ) AS "windowRank"
        FROM deduplicated
        WHERE "duplicateRank" = 1
      )
      SELECT "lectureId", "sourceId", "itemId", "occurredAt", "remembered", "source"
      FROM recent
      WHERE "windowRank" <= ${MASTERY_FLASHCARD_WINDOW}
    `),
    client.$queryRaw<RawInventoryCount[]>(Prisma.sql`
      SELECT "lectureId", COUNT(*)::bigint AS "itemCount"
      FROM "Mcq"
      WHERE "lectureId" IN (${lectureList})
        AND "correctAnswer" IN ('A', 'B', 'C', 'D')
        AND BTRIM("question") <> ''
        AND BTRIM("optionA") <> ''
        AND BTRIM("optionB") <> ''
        AND BTRIM("optionC") <> ''
        AND BTRIM("optionD") <> ''
      GROUP BY "lectureId"
    `),
    client.$queryRaw<RawStudyStats[]>(Prisma.sql`
      SELECT
        "lectureId",
        COUNT(*) FILTER (
          WHERE "actualEndedAt" >= ${focusCutoff}
        )::bigint AS "recentSessionCount",
        COALESCE(
          SUM("activeSeconds") FILTER (
            WHERE "actualEndedAt" >= ${focusCutoff}
          ),
          0
        )::bigint AS "recentSeconds",
        MAX("actualEndedAt") AS "lastStudyEvidenceAt"
      FROM "FocusSession"
      WHERE "userId" = ${userId}
        AND "lectureId" IN (${lectureList})
        AND "status" = 'COMPLETED'
        AND "activeSeconds" >= ${MASTERY_MEANINGFUL_FOCUS_SECONDS}
        AND "actualEndedAt" IS NOT NULL
        AND "actualEndedAt" <= ${asOf}
      GROUP BY "lectureId"
    `),
    client.$queryRaw<RawStudyStats[]>(Prisma.sql`
      SELECT
        summary."effectiveLectureId" AS "lectureId",
        COUNT(*) FILTER (
          WHERE run."runtimeEndedAt" >= ${focusCutoff}
        )::bigint AS "recentSessionCount",
        COALESCE(
          SUM(summary."verifiedFocusSeconds") FILTER (
            WHERE run."runtimeEndedAt" >= ${focusCutoff}
          ),
          0
        )::bigint AS "recentSeconds",
        MAX(run."runtimeEndedAt") AS "lastStudyEvidenceAt"
      FROM "GroupFocusParticipantSummary" AS summary
      INNER JOIN "GroupFocusRun" AS run ON run."id" = summary."runId"
      WHERE summary."userId" = ${userId}
        AND summary."effectiveLectureId" IN (${lectureList})
        AND summary."verifiedFocusSeconds" >= ${MASTERY_MEANINGFUL_FOCUS_SECONDS}
        AND run."runtimeEndedAt" <= ${asOf}
      GROUP BY summary."effectiveLectureId"
    `),
    client.$queryRaw<RawRecallTimestamp[]>(Prisma.sql`
      SELECT
        attempt."lectureId",
        MAX(attempt."answeredAt") AS "lastRecallEvidenceAt"
      FROM "RecallAttempt" AS attempt
      WHERE attempt."userId" = ${userId}
        AND attempt."lectureId" IN (${lectureList})
        AND attempt."status" = 'ANSWERED'
        AND attempt."privacyClass" = 'PRIVATE_STUDY'
        AND attempt."answeredAt" IS NOT NULL
        AND attempt."answeredAt" <= ${asOf}
        AND (
          (
            attempt."itemType" = 'MCQ'
            AND attempt."evidenceClass" = 'SERVER_DERIVED'
            AND attempt."outcome" IN ('CORRECT', 'INCORRECT')
          )
          OR (
            attempt."itemType" = 'FLASHCARD'
            AND attempt."evidenceClass" = 'CLIENT_OBSERVED'
            AND attempt."outcome" IN (
              'SELF_REPORTED_HARD',
              'SELF_REPORTED_EASY'
            )
          )
        )
      GROUP BY attempt."lectureId"
    `),
  ]);

  const objectiveByLecture = groupBy(objectiveRows);
  const flashcardsByLecture = groupBy(flashcardRows);
  const inventoryByLecture = new Map(
    inventoryRows.map((row) => [row.lectureId, toSafeNonnegativeInteger(row.itemCount)]),
  );
  const focusByLecture = new Map(focusRows.map((row) => [row.lectureId, row]));
  const groupFocusByLecture = new Map(groupFocusRows.map((row) => [row.lectureId, row]));
  const recallTimestampByLecture = new Map(
    recallTimestampRows.map((row) => [row.lectureId, row.lastRecallEvidenceAt]),
  );

  return ids.map((lectureId) => {
    const objectiveOutcomes = (objectiveByLecture.get(lectureId) ?? [])
      .filter(validRawObjective)
      .map((row): ObjectiveOutcome => ({
        id: `${row.source}:${row.sourceId}`,
        itemId: row.itemId,
        occurredAt: row.occurredAt,
        correct: row.correct,
        source: row.source,
      }));
    const flashcardOutcomes = (flashcardsByLecture.get(lectureId) ?? [])
      .filter(validRawFlashcard)
      .map((row): FlashcardOutcome => ({
        id: `${row.source}:${row.sourceId}`,
        itemId: row.itemId,
        occurredAt: row.occurredAt,
        remembered: row.remembered,
        source: row.source,
      }));
    const focus = focusByLecture.get(lectureId);
    const groupFocus = groupFocusByLecture.get(lectureId);
    const lastRecallEvidenceAt = recallTimestampByLecture.get(lectureId) ?? null;
    const soloSessions = toSafeNonnegativeInteger(focus?.recentSessionCount ?? 0);
    const groupSessions = toSafeNonnegativeInteger(
      groupFocus?.recentSessionCount ?? 0,
    );
    const soloSeconds = toSafeNonnegativeInteger(focus?.recentSeconds ?? 0);
    const groupSeconds = toSafeNonnegativeInteger(groupFocus?.recentSeconds ?? 0);

    return {
      userId,
      lectureId,
      asOf: new Date(asOf.getTime()),
      availableObjectiveItemCount: inventoryByLecture.get(lectureId) ?? 0,
      objectiveOutcomes,
      flashcardOutcomes,
      lastRecallEvidenceAt,
      study: {
        meaningfulFocusSessionCount: addClamped(soloSessions, groupSessions),
        meaningfulFocusSeconds: addClamped(soloSeconds, groupSeconds),
        lastStudyEvidenceAt: latestDate([
          focus?.lastStudyEvidenceAt ?? null,
          groupFocus?.lastStudyEvidenceAt ?? null,
          ...objectiveOutcomes.map((item) => item.occurredAt),
          ...flashcardOutcomes.map((item) => item.occurredAt),
        ]),
      },
    };
  });
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

function validRawObjective(
  row: RawObjectiveOutcome,
): boolean {
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

function validRawFlashcard(
  row: RawFlashcardOutcome,
): boolean {
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

function toSafeNonnegativeInteger(value: bigint | number): number {
  const number = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(Math.floor(number), 2_147_483_647);
}

function addClamped(left: number, right: number): number {
  return Math.min(left + right, 2_147_483_647);
}

function latestDate(values: readonly (Date | null)[]): Date | null {
  let latest: Date | null = null;
  for (const value of values) {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) continue;
    if (!latest || value.getTime() > latest.getTime()) latest = value;
  }
  return latest;
}