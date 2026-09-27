import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import test from "node:test";
import {
  loadLectureRetentionMemoryEvidence,
} from "../server/features/mastery/retentionEvidence.js";
import {
  refreshLectureRetention,
} from "../server/features/mastery/retentionRefresh.js";
import {
  reconcileLectureRetention,
} from "../server/features/mastery/retentionReconciliation.js";
import {
  listDueLectureReviews,
} from "../server/features/mastery/dueReviewService.js";
import {
  getPrompt32RetentionPostgresGateUrl,
} from "./helpers/prompt32RetentionPostgresGate.js";

const databaseUrl = getPrompt32RetentionPostgresGateUrl();
const skipped = databaseUrl
  ? false
  : "Set the explicit isolated Prompt 32 PostgreSQL test markers to run.";
const DAY = 24 * 60 * 60 * 1000;

test(
  "Prompt 32 PostgreSQL projection, source bounds, privacy, repair, and side-effect gate",
  { skip: skipped },
  async () => {
    assert.ok(databaseUrl);
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    const userIds: string[] = [];
    const lectureIds: string[] = [];
    const focusPlanIds: string[] = [];
    const focusSessionIds: string[] = [];

    try {
      await prisma.$connect();
      const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = current_schema()
      `;
      assert.ok(
        tables.some((table) => table.table_name === "LectureRetention"),
        "The additive LectureRetention migration must be applied.",
      );
      const migration = await prisma.$queryRaw<
        Array<{ migration_name: string }>
      >`
        SELECT migration_name
        FROM "_prisma_migrations"
        WHERE migration_name = '20260927120000_lecture_retention'
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
      `;
      assert.equal(migration.length, 1);
      assert.equal(await prisma.lectureRetention.count(), 0);
      assert.equal(await prisma.lectureMastery.count(), 0);

      const user = await prisma.user.create({
        data: { email: `prompt32-${randomUUID()}@example.test` },
        select: { id: true },
      });
      userIds.push(user.id);
      const otherUser = await prisma.user.create({
        data: { email: `prompt32-other-${randomUUID()}@example.test` },
        select: { id: true },
      });
      userIds.push(otherUser.id);
      const lecture = await createLecture(prisma, "forgetting");
      lectureIds.push(lecture.id);
      const focusLecture = await createLecture(prisma, "focus-only");
      lectureIds.push(focusLecture.id);
      const historyLecture = await createLecture(prisma, "bounded-history");
      lectureIds.push(historyLecture.id);
      const lookbackLecture = await createLecture(prisma, "lookback");
      lectureIds.push(lookbackLecture.id);

      const mcq = await prisma.mcq.create({
        data: {
          question: "Prompt 32 retention source",
          optionA: "Correct",
          optionB: "Wrong B",
          optionC: "Wrong C",
          optionD: "Wrong D",
          correctAnswer: "A",
          lectureId: lecture.id,
        },
        select: { id: true },
      });
      const flashcard = await prisma.flashcard.create({
        data: {
          clinicalConcept: "Prompt 32 retention flashcard",
          explanation: "Flashcard retention test.",
          lectureId: lecture.id,
        },
        select: { id: true },
      });
      const historyMcq = await createMcq(prisma, historyLecture.id, "history");
      const lookbackMcq = await createMcq(prisma, lookbackLecture.id, "lookback");

      const asOf = new Date("2026-09-27T10:00:00.000Z");
      const objectivePositiveAt = new Date(asOf.getTime() - 3 * DAY);
      const objectiveNegativeAt = new Date(asOf.getTime() - DAY);
      const flashcardPositiveAt = new Date(asOf.getTime() - 5 * DAY);
      const flashcardNegativeAt = new Date(asOf.getTime() - 2 * DAY);
      await createStudyEvent(prisma, {
        userId: user.id,
        lectureId: lecture.id,
        itemId: mcq.id,
        itemType: "MCQ",
        at: objectivePositiveAt,
        correct: true,
      });
      const mirroredRecall = await prisma.recallAttempt.create({
        data: {
          userId: user.id,
          itemType: "MCQ",
          itemId: mcq.id,
          lectureId: lecture.id,
          status: "ANSWERED",
          presentedAt: objectivePositiveAt,
          answeredAt: objectivePositiveAt,
          answerKind: "MCQ_OPTION",
          answerValue: "A",
          outcome: "CORRECT",
          evidenceClass: "SERVER_DERIVED",
          privacyClass: "PRIVATE_STUDY",
          issuanceIdempotencyKey: `prompt32-mirror-${randomUUID()}`,
          issuanceFingerprint: createHash("sha256")
            .update(randomUUID())
            .digest("hex"),
        },
        select: { id: true },
      });
      await createStudyEvent(prisma, {
        userId: user.id,
        lectureId: lecture.id,
        itemId: mcq.id,
        itemType: "MCQ",
        at: objectiveNegativeAt,
        correct: false,
      });
      await createStudyEvent(prisma, {
        userId: user.id,
        lectureId: lecture.id,
        itemId: flashcard.id,
        itemType: "FLASHCARD",
        at: flashcardPositiveAt,
        quality: "GOOD",
      });
      const mirroredFlashcardRecall = await prisma.recallAttempt.create({
        data: {
          userId: user.id,
          itemType: "FLASHCARD",
          itemId: flashcard.id,
          lectureId: lecture.id,
          status: "ANSWERED",
          presentedAt: flashcardPositiveAt,
          answeredAt: flashcardPositiveAt,
          answerKind: "FLASHCARD_RECALL_RATING",
          answerValue: "easy",
          outcome: "SELF_REPORTED_EASY",
          evidenceClass: "CLIENT_OBSERVED",
          privacyClass: "PRIVATE_STUDY",
          issuanceIdempotencyKey: `prompt32-card-mirror-${randomUUID()}`,
          issuanceFingerprint: createHash("sha256")
            .update(randomUUID())
            .digest("hex"),
        },
        select: { id: true },
      });
      await createStudyEvent(prisma, {
        userId: user.id,
        lectureId: lecture.id,
        itemId: flashcard.id,
        itemType: "FLASHCARD",
        at: flashcardNegativeAt,
        quality: "AGAIN",
      });
      await createStudyEvent(prisma, {
        userId: user.id,
        lectureId: historyLecture.id,
        itemId: historyMcq.id,
        itemType: "MCQ",
        at: new Date(asOf.getTime() - 30 * DAY),
        correct: true,
      });
      for (let index = 0; index < 20; index += 1) {
        await createStudyEvent(prisma, {
          userId: user.id,
          lectureId: historyLecture.id,
          itemId: historyMcq.id,
          itemType: "MCQ",
          at: new Date(asOf.getTime() - (20 - index) * DAY),
          correct: false,
        });
      }
      await createStudyEvent(prisma, {
        userId: user.id,
        lectureId: lookbackLecture.id,
        itemId: lookbackMcq.id,
        itemType: "MCQ",
        at: new Date(asOf.getTime() - 181 * DAY),
        correct: true,
      });
      await createStudyEvent(prisma, {
        userId: user.id,
        lectureId: lookbackLecture.id,
        itemId: lookbackMcq.id,
        itemType: "MCQ",
        at: new Date(asOf.getTime() - 179 * DAY),
        correct: false,
      });

      const loaded = await loadLectureRetentionMemoryEvidence(
        prisma,
        user.id,
        [lecture.id],
        asOf,
      );
      const loadedEvidence = loaded[0];
      assert.ok(loadedEvidence);
      assert.equal(loadedEvidence.objectiveOutcomes.length, 2);
      const loadedPositiveMcq = loadedEvidence.objectiveOutcomes.find(
        (outcome) => outcome.correct,
      );
      assert.equal(loadedPositiveMcq?.source, "RECALL");
      assert.equal(loadedPositiveMcq?.id, `RECALL_OR_MCQ:${mirroredRecall.id}`);
      assert.equal(loadedEvidence.flashcardOutcomes.length, 2);
      const loadedPositiveFlashcard = loadedEvidence.flashcardOutcomes.find(
        (outcome) => outcome.remembered,
      );
      assert.equal(loadedPositiveFlashcard?.source, "RECALL");
      assert.equal(
        loadedPositiveFlashcard?.id,
        `RECALL_OR_FLASHCARD:${mirroredFlashcardRecall.id}`,
      );
      const boundedEvidence = await loadLectureRetentionMemoryEvidence(
        prisma,
        user.id,
        [historyLecture.id, lookbackLecture.id],
        asOf,
      );
      const boundedHistory = boundedEvidence.find(
        (item) => item.lectureId === historyLecture.id,
      );
      const boundedLookback = boundedEvidence.find(
        (item) => item.lectureId === lookbackLecture.id,
      );
      assert.equal(boundedHistory?.objectiveOutcomes.length, 20);
      assert.equal(
        boundedHistory?.objectiveOutcomes.some((outcome) => outcome.correct),
        false,
      );
      assert.equal(boundedLookback?.objectiveOutcomes.length, 1);
      assert.equal(boundedLookback?.objectiveOutcomes[0]?.correct, false);

      const plan = await prisma.focusPlan.create({
        data: {
          userId: user.id,
          title: "Prompt 32 focus-only",
          timezone: "UTC",
        },
        select: { id: true },
      });
      focusPlanIds.push(plan.id);
      const planItem = await prisma.focusPlanItem.create({
        data: {
          planId: plan.id,
          lectureId: focusLecture.id,
          sequence: 0,
          sessionCount: 1,
          focusDurationSeconds: 3600,
          breakDurationSeconds: 0,
          includeMcq: false,
          includeFlashcards: false,
          includeVideo: false,
        },
        select: { id: true },
      });
      const focus = await prisma.focusSession.create({
        data: {
          userId: user.id,
          planId: plan.id,
          planItemId: planItem.id,
          lectureId: focusLecture.id,
          status: "COMPLETED",
          activeSeconds: 3600,
          actualEndedAt: new Date(asOf.getTime() - 2 * DAY),
          idempotencyKey: `prompt32-focus-${randomUUID()}`,
        },
        select: { id: true },
      });
      focusSessionIds.push(focus.id);
      const sideEffectsBefore = await readSideEffectCounts(prisma);

      const firstRefresh = await refreshLectureRetention({
        userId: user.id,
        lectureId: lecture.id,
        asOf,
      });
      assert.equal(firstRefresh.row.ruleVersion, "retention-v1");
      assert.equal(firstRefresh.row.sourceMasteryRuleVersion, "mastery-v1");
      assert.equal(firstRefresh.row.objectiveForgettingItemCount, 1);
      assert.equal(firstRefresh.row.selfReportedForgettingItemCount, 1);
      assert.equal(firstRefresh.row.forgettingEvidenceKind, "MIXED");
      assert.equal(firstRefresh.row.reviewState, "DUE");
      assert.equal(firstRefresh.row.reviewUrgencyScore, 100);
      assert.equal(
        firstRefresh.row.retentionAnchorAt?.getTime(),
        objectiveNegativeAt.getTime(),
      );
      assert.equal(
        firstRefresh.row.lastForgettingEvidenceAt?.getTime(),
        objectiveNegativeAt.getTime(),
      );

      const concurrent = await Promise.all(
        Array.from({ length: 20 }, () =>
          refreshLectureRetention({
            userId: user.id,
            lectureId: lecture.id,
            asOf,
          }),
        ),
      );
      assert.equal(concurrent.length, 20);
      const retainedRows = await prisma.lectureRetention.findMany({
        where: { userId: user.id, lectureId: lecture.id },
      });
      assert.equal(retainedRows.length, 1);
      const currentMastery = await prisma.lectureMastery.findUniqueOrThrow({
        where: { userId_lectureId: { userId: user.id, lectureId: lecture.id } },
      });
      assert.equal(
        retainedRows[0]?.sourceMasteryRevision,
        currentMastery.revision,
      );

      const dueForOwner = await listDueLectureReviews({
        userId: user.id,
        asOf,
        database: prisma,
      });
      assert.equal(dueForOwner.items.length, 1);
      assert.equal(dueForOwner.items[0]?.lectureId, lecture.id);
      assert.equal(dueForOwner.items[0]?.reviewUrgencyScore, 100);
      const dueForOtherUser = await listDueLectureReviews({
        userId: otherUser.id,
        asOf,
        database: prisma,
      });
      assert.deepEqual(dueForOtherUser.items, []);

      await createStudyEvent(prisma, {
        userId: user.id,
        lectureId: lecture.id,
        itemId: mcq.id,
        itemType: "MCQ",
        at: new Date(asOf.getTime() - 60 * 60 * 1000),
        correct: true,
      });
      await createStudyEvent(prisma, {
        userId: user.id,
        lectureId: lecture.id,
        itemId: flashcard.id,
        itemType: "FLASHCARD",
        at: new Date(asOf.getTime() - 30 * 60 * 1000),
        quality: "GOOD",
      });
      const recovered = await refreshLectureRetention({
        userId: user.id,
        lectureId: lecture.id,
        asOf,
      });
      assert.equal(recovered.row.objectiveForgettingItemCount, 0);
      assert.equal(recovered.row.selfReportedForgettingItemCount, 0);
      assert.equal(recovered.row.forgettingEvidenceKind, "NONE");
      assert.equal(recovered.row.lastForgettingEvidenceAt, null);

      const inSync = await reconcileLectureRetention({
        userId: user.id,
        lectureId: lecture.id,
        asOf,
        database: prisma,
      });
      assert.equal(inSync.status, "IN_SYNC");
      const driftTarget = await prisma.lectureRetention.findUniqueOrThrow({
        where: { userId_lectureId: { userId: user.id, lectureId: lecture.id } },
      });
      await prisma.lectureRetention.update({
        where: { id: driftTarget.id },
        data: {
          retentionScore:
            driftTarget.retentionScore === null
              ? 1
              : (driftTarget.retentionScore + 1) % 101,
        },
      });
      const drift = await reconcileLectureRetention({
        userId: user.id,
        lectureId: lecture.id,
        asOf,
        database: prisma,
      });
      assert.ok(drift.mismatches.includes("RETENTION_SCORE_MISMATCH"));
      const repaired = await reconcileLectureRetention({
        userId: user.id,
        lectureId: lecture.id,
        repair: true,
        asOf,
        database: prisma,
      });
      assert.equal(repaired.status, "IN_SYNC");
      assert.equal(repaired.repaired, true);

      const focusOnly = await refreshLectureRetention({
        userId: user.id,
        lectureId: focusLecture.id,
        asOf,
      });
      assert.equal(focusOnly.row.retentionAnchorAt, null);
      assert.equal(focusOnly.row.reviewState, "INSUFFICIENT_EVIDENCE");
      assert.equal(focusOnly.row.retentionScore, null);
      assert.equal(focusOnly.row.nextReviewAt, null);

      const sideEffectsAfter = await readSideEffectCounts(prisma);
      assert.deepEqual(sideEffectsAfter, sideEffectsBefore);
      assert.equal(await prisma.lectureRetention.count(), 2);
    } finally {
      if (userIds.length > 0) {
        await prisma.focusSession.deleteMany({
          where: { userId: { in: userIds } },
        });
        await prisma.focusPlan.deleteMany({
          where: { userId: { in: userIds } },
        });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
      if (focusPlanIds.length > 0) {
        await prisma.focusPlan.deleteMany({
          where: { id: { in: focusPlanIds } },
        });
      }
      if (focusSessionIds.length > 0) {
        await prisma.focusSession.deleteMany({
          where: { id: { in: focusSessionIds } },
        });
      }
      if (lectureIds.length > 0) {
        await prisma.lecture.deleteMany({ where: { id: { in: lectureIds } } });
      }
      await prisma.$disconnect();
    }
  },
);

async function createLecture(
  prisma: PrismaClient,
  label: string,
): Promise<{ id: string }> {
  return prisma.lecture.create({
    data: {
      name: `Prompt 32 ${label} ${randomUUID()}`,
      mainSubject: "Retention",
      trackMode: "test",
    },
    select: { id: true },
  });
}

async function createMcq(
  prisma: PrismaClient,
  lectureId: string,
  label: string,
): Promise<{ id: string }> {
  return prisma.mcq.create({
    data: {
      question: `Prompt 32 ${label} source`,
      optionA: "Correct",
      optionB: "Wrong B",
      optionC: "Wrong C",
      optionD: "Wrong D",
      correctAnswer: "A",
      lectureId,
    },
    select: { id: true },
  });
}

async function createStudyEvent(
  prisma: PrismaClient,
  input: {
    userId: string;
    lectureId: string;
    itemId: string;
    itemType: "MCQ" | "FLASHCARD";
    at: Date;
    correct?: boolean;
    quality?: "AGAIN" | "HARD" | "GOOD" | "EASY";
  },
): Promise<void> {
  const isMcq = input.itemType === "MCQ";
  await prisma.studyEvent.create({
    data: {
      eventType: isMcq ? "mcq_attempted" : "flashcard_reviewed",
      userId: input.userId,
      occurredAt: input.at,
      receivedAt: input.at,
      source: "backend",
      idempotencyKey: `prompt32-${randomUUID()}`,
      lectureId: input.lectureId,
      mcqId: isMcq ? input.itemId : null,
      flashcardId: isMcq ? null : input.itemId,
      evidenceClass: "SERVER_VALIDATED",
      privacyClass: "PRIVATE_STUDY",
      payload: isMcq
        ? { correct: input.correct ?? false }
        : { quality: input.quality ?? "AGAIN" },
    },
  });
}

async function readSideEffectCounts(prisma: PrismaClient): Promise<{
  outbox: number;
  pointsLedger: number;
  pointsBalance: number;
  pointsLog: number;
  achievements: number;
  achievementProgress: number;
  levels: number;
  challengeInstances: number;
  challengeProgress: number;
  leaderboards: number;
  integritySignals: number;
  calendar: number;
  focusPlanItems: number;
  recallAttempts: number;
}> {
  const [
    outbox,
    pointsLedger,
    pointsBalance,
    pointsLog,
    achievements,
    achievementProgress,
    levels,
    challengeInstances,
    challengeProgress,
    leaderboards,
    integritySignals,
    calendar,
    focusPlanItems,
    recallAttempts,
  ] = await Promise.all([
    prisma.privateD1SyncOutbox.count(),
    prisma.studyPointsLedgerEntry.count(),
    prisma.studyPointsBalanceProjection.count(),
    prisma.pointsLog.count(),
    prisma.userAchievement.count(),
    prisma.userAchievementProgress.count(),
    prisma.userGamificationLevel.count(),
    prisma.challengeInstance.count(),
    prisma.userChallengeProgress.count(),
    prisma.leaderboardSnapshot.count(),
    prisma.integritySignal.count(),
    prisma.calendarEvent.count(),
    prisma.focusPlanItem.count(),
    prisma.recallAttempt.count(),
  ]);
  return {
    outbox,
    pointsLedger,
    pointsBalance,
    pointsLog,
    achievements,
    achievementProgress,
    levels,
    challengeInstances,
    challengeProgress,
    leaderboards,
    integritySignals,
    calendar,
    focusPlanItems,
    recallAttempts,
  };
}