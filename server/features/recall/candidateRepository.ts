import { Prisma, type PrismaClient } from "@prisma/client";
import type { RecallItemType } from "./constants.js";
import { RECALL_CANDIDATE_LIMITS } from "./candidateWeights.js";
import type {
  RecallCandidateItem,
  RecallCandidateItemState,
  RecallLectureStudyFact,
  RecallMemoryEvidence,
} from "./candidateTypes.js";
import { normalizeRecallMemoryOutcome, normalizeStudyEventMemoryOutcome } from "./sourceEvidence.js";
import type { RecallTransaction } from "./types.js";

export type RecallCandidateQueryClient = PrismaClient | RecallTransaction;

interface EventStudyGroupRow {
  lectureId: string;
  eventType: string;
  firstOccurredAt: Date;
  lastOccurredAt: Date;
}

interface RawCandidateItem {
  itemType: string;
  itemId: string;
  lectureId: string;
}

interface RawRecallHistory {
  id: string;
  itemType: string;
  itemId: string;
  answeredAt: Date;
  outcome: string;
  evidenceClass: string;
}

interface RawStudyEventHistory {
  id: string;
  itemType: string;
  itemId: string;
  occurredAt: Date;
  rawValue: string;
  evidenceClass: string;
}

export async function loadRecallLectureStudyFacts(
  client: RecallCandidateQueryClient,
  userId: string,
  asOf: Date,
): Promise<RecallLectureStudyFact[]> {
  const [focusRows, groupRows, eventRows] = await Promise.all([
    client.focusSession.groupBy({
      by: ["lectureId"],
      where: {
        userId,
        status: "COMPLETED",
        activeSeconds: { gte: RECALL_CANDIDATE_LIMITS.meaningfulFocusSeconds },
        actualEndedAt: { not: null, lte: asOf },
      },
      _min: { actualEndedAt: true },
      _max: { actualEndedAt: true },
    }),
    client.groupFocusParticipantSummary.groupBy({
      by: ["effectiveLectureId"],
      where: {
        userId,
        verifiedFocusSeconds: { gt: 0 },
        createdAt: { lte: asOf },
      },
      _min: { createdAt: true },
      _max: { createdAt: true },
    }),
    loadStudyEventLectureGroups(client, userId, asOf),
  ]);

  const facts: RecallLectureStudyFact[] = [];
  for (const row of focusRows) {
    const firstStudiedAt = row._min.actualEndedAt;
    const lastStudiedAt = row._max.actualEndedAt;
    if (!firstStudiedAt || !lastStudiedAt) continue;
    facts.push(
      { lectureId: row.lectureId, studiedAt: firstStudiedAt, evidenceSource: "FOCUS" },
      { lectureId: row.lectureId, studiedAt: lastStudiedAt, evidenceSource: "FOCUS" },
    );
  }
  for (const row of groupRows) {
    const firstStudiedAt = row._min.createdAt;
    const lastStudiedAt = row._max.createdAt;
    if (!firstStudiedAt || !lastStudiedAt) continue;
    facts.push(
      {
        lectureId: row.effectiveLectureId,
        studiedAt: firstStudiedAt,
        evidenceSource: "GROUP_FOCUS",
      },
      {
        lectureId: row.effectiveLectureId,
        studiedAt: lastStudiedAt,
        evidenceSource: "GROUP_FOCUS",
      },
    );
  }
  for (const row of eventRows) {
    const evidenceSource =
      row.eventType === "mcq_attempted" || row.eventType === "mcq_reviewed"
        ? "MCQ"
        : row.eventType === "flashcard_reviewed"
          ? "FLASHCARD"
          : "SERVER_STUDY_PROGRESS";
    facts.push(
      { lectureId: row.lectureId, studiedAt: row.firstOccurredAt, evidenceSource },
      { lectureId: row.lectureId, studiedAt: row.lastOccurredAt, evidenceSource },
    );
  }
  return facts;
}

async function loadStudyEventLectureGroups(
  client: RecallCandidateQueryClient,
  userId: string,
  asOf: Date,
): Promise<EventStudyGroupRow[]> {
  return client.$queryRaw<EventStudyGroupRow[]>(Prisma.sql`
    WITH canonical_events AS (
      SELECT
        COALESCE(event."lectureId", mcq."lectureId") AS "lectureId",
        event."eventType",
        event."occurredAt"
      FROM "StudyEvent" AS event
      INNER JOIN "Mcq" AS mcq ON mcq."id" = event."mcqId"
      WHERE event."userId" = ${userId}
        AND event."eventType" IN ('mcq_attempted', 'mcq_reviewed')
        AND event."source" IN ('backend', 'offline_replay')
        AND event."evidenceClass" = 'SERVER_VALIDATED'
        AND event."privacyClass" = 'PRIVATE_STUDY'
        AND event."occurredAt" <= ${asOf}
        AND event."mcqId" IS NOT NULL
        AND (event."lectureId" IS NULL OR event."lectureId" = mcq."lectureId")

      UNION ALL

      SELECT
        COALESCE(event."lectureId", flashcard."lectureId") AS "lectureId",
        event."eventType",
        event."occurredAt"
      FROM "StudyEvent" AS event
      INNER JOIN "Flashcard" AS flashcard ON flashcard."id" = event."flashcardId"
      WHERE event."userId" = ${userId}
        AND event."eventType" = 'flashcard_reviewed'
        AND event."source" IN ('backend', 'offline_replay')
        AND event."evidenceClass" = 'SERVER_VALIDATED'
        AND event."privacyClass" = 'PRIVATE_STUDY'
        AND event."occurredAt" <= ${asOf}
        AND event."flashcardId" IS NOT NULL
        AND (event."lectureId" IS NULL OR event."lectureId" = flashcard."lectureId")

      UNION ALL

      SELECT event."lectureId", event."eventType", event."occurredAt"
      FROM "StudyEvent" AS event
      WHERE event."userId" = ${userId}
        AND event."eventType" = 'lecture_completion_confirmed'
        AND event."source" IN ('backend', 'offline_replay')
        AND event."evidenceClass" = 'SERVER_VALIDATED'
        AND event."privacyClass" = 'PRIVATE_STUDY'
        AND event."lectureId" IS NOT NULL
        AND event."occurredAt" <= ${asOf}
    )
    SELECT
      "lectureId",
      "eventType",
      MIN("occurredAt") AS "firstOccurredAt",
      MAX("occurredAt") AS "lastOccurredAt"
    FROM canonical_events
    WHERE "lectureId" IS NOT NULL
    GROUP BY "lectureId", "eventType"
  `);
}

export async function fetchEligibleRecallCandidateItems(
  client: RecallCandidateQueryClient,
  studiedLectureIds: readonly string[],
): Promise<RecallCandidateItem[]> {
  if (studiedLectureIds.length === 0) return [];

  const orderedLectureIds = Prisma.join(
    studiedLectureIds.map((lectureId) => Prisma.sql`${lectureId}`),
  );
  const rows = await client.$queryRaw<RawCandidateItem[]>(Prisma.sql`
    WITH eligible_lectures AS (
      SELECT input."lectureId", input."lectureOrder"
      FROM unnest(ARRAY[${orderedLectureIds}]::text[])
        WITH ORDINALITY AS input("lectureId", "lectureOrder")
    ),
    mcq_candidates AS (
      SELECT
        mcq."id" AS "itemId",
        mcq."lectureId",
        eligible."lectureOrder",
        ROW_NUMBER() OVER (
          PARTITION BY mcq."lectureId"
          ORDER BY mcq."id" ASC
        ) AS "lectureRank"
      FROM "Mcq" AS mcq
      INNER JOIN eligible_lectures AS eligible
        ON eligible."lectureId" = mcq."lectureId"
      WHERE mcq."correctAnswer" IN ('A', 'B', 'C', 'D')
        AND BTRIM(mcq."question") <> ''
        AND BTRIM(mcq."optionA") <> ''
        AND BTRIM(mcq."optionB") <> ''
        AND BTRIM(mcq."optionC") <> ''
        AND BTRIM(mcq."optionD") <> ''
    ),
    flashcard_candidates AS (
      SELECT
        flashcard."id" AS "itemId",
        flashcard."lectureId",
        eligible."lectureOrder",
        ROW_NUMBER() OVER (
          PARTITION BY flashcard."lectureId"
          ORDER BY flashcard."id" ASC
        ) AS "lectureRank"
      FROM "Flashcard" AS flashcard
      INNER JOIN eligible_lectures AS eligible
        ON eligible."lectureId" = flashcard."lectureId"
      WHERE BTRIM(flashcard."clinicalConcept") <> ''
        AND BTRIM(flashcard."explanation") <> ''
    ),
    bounded_candidates AS (
      SELECT
        'MCQ'::text AS "itemType",
        "itemId",
        "lectureId",
        "lectureOrder"
      FROM mcq_candidates
      WHERE "lectureRank" <= ${RECALL_CANDIDATE_LIMITS.maxMcqsPerLecture}

      UNION ALL

      SELECT
        'FLASHCARD'::text AS "itemType",
        "itemId",
        "lectureId",
        "lectureOrder"
      FROM flashcard_candidates
      WHERE "lectureRank" <= ${RECALL_CANDIDATE_LIMITS.maxFlashcardsPerLecture}
    )
    SELECT "itemType", "itemId", "lectureId"
    FROM bounded_candidates
    ORDER BY
      "lectureOrder" ASC,
      CASE "itemType" WHEN 'MCQ' THEN 0 ELSE 1 END ASC,
      "itemId" ASC
    LIMIT ${RECALL_CANDIDATE_LIMITS.maxRawCandidates}
  `);

  return rows.map((row) => ({
    itemType: row.itemType as RecallItemType,
    itemId: row.itemId,
    lectureId: row.lectureId,
  }));
}

export async function loadRecallCandidateItemStates(
  client: RecallCandidateQueryClient,
  userId: string,
  candidates: readonly RecallCandidateItem[],
): Promise<RecallCandidateItemState[]> {
  const itemIds = [...new Set(candidates.map(({ itemId }) => itemId))];
  if (itemIds.length === 0) return [];

  return client.recallItemState.findMany({
    where: {
      userId,
      itemType: { in: ["MCQ", "FLASHCARD"] },
      itemId: { in: itemIds },
    },
    select: {
      itemType: true,
      itemId: true,
      lastPresentedAt: true,
      lastAnsweredAt: true,
      lastOutcome: true,
    },
  }) as Promise<RecallCandidateItemState[]>;
}

export async function loadRecallCandidateMemoryEvidence(
  client: RecallCandidateQueryClient,
  userId: string,
  candidates: readonly RecallCandidateItem[],
  asOf: Date,
): Promise<RecallMemoryEvidence[]> {
  if (candidates.length === 0) return [];

  const cutoff = new Date(
    asOf.getTime() -
      RECALL_CANDIDATE_LIMITS.historyWindowDays * 24 * 60 * 60 * 1000,
  );
  const mcqIds = [...new Set(
    candidates
      .filter(({ itemType }) => itemType === "MCQ")
      .map(({ itemId }) => itemId),
  )];
  const flashcardIds = [...new Set(
    candidates
      .filter(({ itemType }) => itemType === "FLASHCARD")
      .map(({ itemId }) => itemId),
  )];
  const recallFilters: Prisma.Sql[] = [];
  if (mcqIds.length > 0) {
    recallFilters.push(
      Prisma.sql`("itemType" = 'MCQ' AND "itemId" IN (${Prisma.join(mcqIds)}))`,
    );
  }
  if (flashcardIds.length > 0) {
    recallFilters.push(
      Prisma.sql`("itemType" = 'FLASHCARD' AND "itemId" IN (${Prisma.join(flashcardIds)}))`,
    );
  }
  const recallFilter = Prisma.join(recallFilters, " OR ");

  const recallRows = await client.$queryRaw<RawRecallHistory[]>(Prisma.sql`
    WITH scoped_history AS (
      SELECT
        attempt."id",
        attempt."itemType",
        attempt."itemId",
        attempt."answeredAt",
        attempt."outcome",
        attempt."evidenceClass",
        ROW_NUMBER() OVER (
          PARTITION BY attempt."itemType", attempt."itemId"
          ORDER BY attempt."answeredAt" DESC, attempt."id" DESC
        ) AS "historyRank"
      FROM "RecallAttempt" AS attempt
      WHERE attempt."userId" = ${userId}
        AND attempt."status" = 'ANSWERED'
        AND attempt."privacyClass" = 'PRIVATE_STUDY'
        AND attempt."answeredAt" IS NOT NULL
        AND attempt."answeredAt" >= ${cutoff}
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
              'SELF_REPORTED_MEDIUM',
              'SELF_REPORTED_EASY'
            )
          )
        )
        AND (${recallFilter})
    )
    SELECT "id", "itemType", "itemId", "answeredAt", "outcome", "evidenceClass"
    FROM scoped_history
    WHERE "historyRank" <= ${RECALL_CANDIDATE_LIMITS.maxMeaningfulHistory}
  `);

  const eventBranches: Prisma.Sql[] = [];
  if (mcqIds.length > 0) {
    eventBranches.push(Prisma.sql`
      SELECT
        event."id",
        'MCQ'::text AS "itemType",
        event."mcqId" AS "itemId",
        event."occurredAt",
        event."payload"->>'correct' AS "rawValue",
        event."evidenceClass"
      FROM "StudyEvent" AS event
      INNER JOIN "Mcq" AS mcq ON mcq."id" = event."mcqId"
      WHERE event."userId" = ${userId}
        AND event."eventType" = 'mcq_attempted'
        AND event."source" IN ('backend', 'offline_replay')
        AND event."evidenceClass" = 'SERVER_VALIDATED'
        AND event."privacyClass" = 'PRIVATE_STUDY'
        AND event."occurredAt" >= ${cutoff}
        AND event."occurredAt" <= ${asOf}
        AND event."mcqId" IN (${Prisma.join(mcqIds)})
        AND (event."lectureId" IS NULL OR event."lectureId" = mcq."lectureId")
        AND event."payload"->>'correct' IN ('true', 'false')
    `);
  }
  if (flashcardIds.length > 0) {
    eventBranches.push(Prisma.sql`
      SELECT
        event."id",
        'FLASHCARD'::text AS "itemType",
        event."flashcardId" AS "itemId",
        event."occurredAt",
        event."payload"->>'quality' AS "rawValue",
        event."evidenceClass"
      FROM "StudyEvent" AS event
      INNER JOIN "Flashcard" AS flashcard ON flashcard."id" = event."flashcardId"
      WHERE event."userId" = ${userId}
        AND event."eventType" = 'flashcard_reviewed'
        AND event."source" IN ('backend', 'offline_replay')
        AND event."evidenceClass" = 'SERVER_VALIDATED'
        AND event."privacyClass" = 'PRIVATE_STUDY'
        AND event."occurredAt" >= ${cutoff}
        AND event."occurredAt" <= ${asOf}
        AND event."flashcardId" IN (${Prisma.join(flashcardIds)})
        AND (event."lectureId" IS NULL OR event."lectureId" = flashcard."lectureId")
        AND event."payload"->>'quality' IN ('AGAIN', 'HARD', 'GOOD', 'EASY')
    `);
  }

  const eventRows = await client.$queryRaw<RawStudyEventHistory[]>(Prisma.sql`
    WITH source_history AS (
      ${Prisma.join(eventBranches, " UNION ALL ")}
    ),
    scoped_history AS (
      SELECT
        source_history.*,
        ROW_NUMBER() OVER (
          PARTITION BY source_history."itemType", source_history."itemId"
          ORDER BY source_history."occurredAt" DESC, source_history."id" DESC
        ) AS "historyRank"
      FROM source_history
    )
    SELECT "id", "itemType", "itemId", "occurredAt", "rawValue", "evidenceClass"
    FROM scoped_history
    WHERE "historyRank" <= ${RECALL_CANDIDATE_LIMITS.maxMeaningfulHistory}
  `);

  const recallEvidence = recallRows.flatMap((row) => {
    const itemType = row.itemType as RecallItemType;
    const outcome = normalizeRecallMemoryOutcome(itemType, row.outcome);
    if (!outcome) return [];
    return [{
      itemType,
      itemId: row.itemId,
      occurredAt: row.answeredAt,
      outcome,
      evidenceClass: row.evidenceClass,
      source: "PROMPT28_RECALL" as const,
      sourceId: row.id,
    }];
  });
  const studyEventEvidence = eventRows.flatMap((row) => {
    const itemType = row.itemType as RecallItemType;
    const outcome = normalizeStudyEventMemoryOutcome(itemType, row.rawValue);
    if (!outcome) return [];
    return [{
      itemType,
      itemId: row.itemId,
      occurredAt: row.occurredAt,
      outcome,
      evidenceClass: row.evidenceClass,
      source: "STUDY_EVENT" as const,
      sourceId: row.id,
    }];
  });
  return [...recallEvidence, ...studyEventEvidence];
}