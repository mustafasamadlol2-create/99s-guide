import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import test from "node:test";
import { createRecallAttemptService } from "../server/features/recall/attemptService.js";
import { reconcileRecallItemState } from "../server/features/recall/reconciliation.js";
import { getPrompt28RecallPostgresGateUrl } from "./helpers/prompt28RecallPostgresGate.js";

const databaseUrl = getPrompt28RecallPostgresGateUrl();
const skipped = databaseUrl
  ? false
  : "Set the explicit Prompt 28 disposable-schema test markers to run.";

test(
  "Prompt 28 PostgreSQL lifecycle, concurrency, rebuild, and zero-side-effect gate",
  { skip: skipped },
  async () => {
    assert.ok(databaseUrl);
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    let userId: string | undefined;
    let otherUserId: string | undefined;
    let lectureId: string | undefined;

    try {
      await prisma.$connect();
      const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = current_schema()
      `;
      const tableNames = new Set(tables.map(({ table_name }) => table_name));
      for (const table of [
        "RecallAttempt",
        "RecallItemState",
        "LeaderboardSeason",
        "LeaderboardSnapshot",
        "GamificationRuleSet",
        "UserAchievement",
        "UserGamificationLevel",
        "ChallengeInstance",
        "StudyPointsLedgerEntry",
        "IntegritySignal",
        "FocusSession",
      ]) {
        assert.ok(tableNames.has(table), `Expected migrated table ${table}.`);
      }
      const migration = await prisma.$queryRaw<
        Array<{ migration_name: string }>
      >`
        SELECT migration_name
        FROM "_prisma_migrations"
        WHERE migration_name = '20260926140000_spaced_recall_attempt_state'
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
      `;
      assert.equal(migration.length, 1, "Prompt 28 migration must be applied.");
      assert.equal(await prisma.recallAttempt.count(), 0);
      assert.equal(await prisma.recallItemState.count(), 0);

      const user = await prisma.user.create({
        data: { email: `prompt28-${randomUUID()}@example.test` },
        select: { id: true },
      });
      userId = user.id;
      const otherUser = await prisma.user.create({
        data: { email: `prompt28-other-${randomUUID()}@example.test` },
        select: { id: true },
      });
      otherUserId = otherUser.id;
      const lecture = await prisma.lecture.create({
        data: {
          name: "Prompt 28 isolated Recall fixture",
          mainSubject: "Verification",
          trackMode: "test",
        },
        select: { id: true },
      });
      lectureId = lecture.id;
      const mcq = await prisma.mcq.create({
        data: {
          question: "Prompt 28 Recall test",
          optionA: "A",
          optionB: "B",
          optionC: "C",
          optionD: "D",
          correctAnswer: "A",
          lectureId,
        },
        select: { id: true },
      });
      const secondMcq = await prisma.mcq.create({
        data: {
          question: "Prompt 28 alternate Recall test",
          optionA: "A",
          optionB: "B",
          optionC: "C",
          optionD: "D",
          correctAnswer: "C",
          lectureId,
        },
        select: { id: true },
      });
      const flashcard = await prisma.flashcard.create({
        data: {
          clinicalConcept: "Prompt 28 Flashcard Recall fixture",
          explanation: "Isolated Recall answer behavior.",
          lectureId,
        },
        select: { id: true },
      });

      const effectsBefore = await sideEffectCounts(prisma, userId);
      let clock = new Date("2026-09-26T12:00:00.000Z");
      const service = createRecallAttemptService({
        database: prisma,
        now: () => new Date(clock),
      });
      const issuanceKey = `prompt28-${randomUUID()}`;
      const issuance = {
        userId,
        itemType: "MCQ" as const,
        itemId: mcq.id,
        issuanceIdempotencyKey: issuanceKey,
      };
      const [issuedA, issuedB] = await Promise.all([
        service.issue(issuance),
        service.issue(issuance),
      ]);
      assert.equal(issuedA.id, issuedB.id, "Concurrent identical issuance must replay.");
      await assert.rejects(
        service.issue({ ...issuance, itemId: secondMcq.id }),
        { code: "RECALL_ISSUANCE_CONFLICT" },
      );

      const correctAttempt = await service.issue({
        ...issuance,
        issuanceIdempotencyKey: `prompt28-${randomUUID()}`,
      });
      const correct = await service.answer(userId, correctAttempt.id, {
        kind: "MCQ_OPTION",
        value: "A",
      });
      assert.equal(correct.outcome, "CORRECT");
      assert.equal(correct.evidenceClass, "SERVER_DERIVED");
      assert.equal(
        (await service.answer(userId, correctAttempt.id, {
          kind: "MCQ_OPTION",
          value: "A",
        })).replayed,
        true,
      );
      await assert.rejects(
        service.answer(userId, correctAttempt.id, {
          kind: "MCQ_OPTION",
          value: "B",
        }),
        { code: "RECALL_ATTEMPT_FINALIZED" },
      );
      await assert.rejects(
        service.answer(otherUserId, correctAttempt.id, {
          kind: "MCQ_OPTION",
          value: "A",
        }),
        { code: "RECALL_ATTEMPT_NOT_FOUND" },
      );

      const incorrectAttempt = await service.issue({
        ...issuance,
        issuanceIdempotencyKey: `prompt28-${randomUUID()}`,
      });
      const incorrect = await service.answer(userId, incorrectAttempt.id, {
        kind: "MCQ_OPTION",
        value: "B",
      });
      assert.equal(incorrect.outcome, "INCORRECT");
      assert.equal(incorrect.evidenceClass, "SERVER_DERIVED");

      const skippedAttempt = await service.issue({
        ...issuance,
        issuanceIdempotencyKey: `prompt28-${randomUUID()}`,
      });
      const skipped = await service.skip(userId, skippedAttempt.id);
      assert.equal(skipped.status, "SKIPPED");
      assert.equal(skipped.outcome, null);

      const expiringAttempt = await service.issue({
        ...issuance,
        issuanceIdempotencyKey: `prompt28-${randomUUID()}`,
        expiresAt: new Date(clock.getTime() + 1_000),
      });
      clock = new Date(clock.getTime() + 2_000);
      const expired = await service.answer(userId, expiringAttempt.id, {
        kind: "MCQ_OPTION",
        value: "A",
      });
      assert.equal(expired.status, "EXPIRED");
      assert.equal(expired.outcome, null);

      const raceAttempt = await service.issue({
        ...issuance,
        issuanceIdempotencyKey: `prompt28-${randomUUID()}`,
      });
      const raceResults = await Promise.allSettled([
        service.answer(userId, raceAttempt.id, {
          kind: "MCQ_OPTION",
          value: "A",
        }),
        service.skip(userId, raceAttempt.id),
      ]);
      assert.equal(
        raceResults.filter((result) => result.status === "fulfilled").length,
        1,
        "Answer-versus-skip must have one winner.",
      );
      assert.equal(
        raceResults.filter((result) => result.status === "rejected").length,
        1,
      );

      for (const rating of ["hard", "medium", "easy"] as const) {
        const flashcardAttempt = await service.issue({
          userId,
          itemType: "FLASHCARD",
          itemId: flashcard.id,
          issuanceIdempotencyKey: `prompt28-${randomUUID()}`,
        });
        const result = await service.answer(userId, flashcardAttempt.id, {
          kind: "FLASHCARD_RECALL_RATING",
          value: rating,
        });
        assert.equal(result.outcome, `SELF_REPORTED_${rating.toUpperCase()}`);
        assert.equal(result.evidenceClass, "CLIENT_OBSERVED");
      }

      const mcqStateKey = {
        userId,
        itemType: "MCQ" as const,
        itemId: mcq.id,
      };
      assert.equal(
        (await reconcileRecallItemState(mcqStateKey, prisma)).matches,
        true,
      );
      const attemptsBeforeRepair = await prisma.recallAttempt.count({
        where: mcqStateKey,
      });
      await prisma.recallItemState.update({
        where: {
          userId_itemType_itemId: mcqStateKey,
        },
        data: { presentationCount: 999 },
      });
      const mismatch = await reconcileRecallItemState(mcqStateKey, prisma);
      assert.equal(mismatch.matches, false);
      assert.ok(mismatch.mismatches.includes("COUNTER_MISMATCH"));
      const repaired = await reconcileRecallItemState(
        { ...mcqStateKey, repair: true },
        prisma,
      );
      assert.equal(repaired.matches, true);
      assert.equal(repaired.repaired, true);
      assert.equal(
        await prisma.recallAttempt.count({ where: mcqStateKey }),
        attemptsBeforeRepair,
        "State repair must not modify RecallAttempt history.",
      );
      const mcqState = await prisma.recallItemState.findUniqueOrThrow({
        where: { userId_itemType_itemId: mcqStateKey },
      });
      assert.equal(mcqState.presentationCount, attemptsBeforeRepair);
      assert.equal(mcqState.objectiveIncorrectCount, 1);
      assert.equal(mcqState.skipCount, 1);

      await prisma.recallItemState.delete({
        where: { userId_itemType_itemId: mcqStateKey },
      });
      const missingState = await reconcileRecallItemState(mcqStateKey, prisma);
      assert.equal(missingState.matches, false);
      assert.ok(missingState.mismatches.includes("MISSING_STATE"));
      const rebuiltState = await reconcileRecallItemState(
        { ...mcqStateKey, repair: true },
        prisma,
      );
      assert.equal(rebuiltState.matches, true);
      assert.equal(rebuiltState.repaired, true);
      assert.equal(
        await prisma.recallAttempt.count({ where: mcqStateKey }),
        attemptsBeforeRepair,
        "Rebuilding state must not modify RecallAttempt history.",
      );

      const flashcardState = await prisma.recallItemState.findUniqueOrThrow({
        where: {
          userId_itemType_itemId: {
            userId,
            itemType: "FLASHCARD",
            itemId: flashcard.id,
          },
        },
      });
      assert.equal(flashcardState.selfReportedHardCount, 1);
      assert.equal(flashcardState.selfReportedMediumCount, 1);
      assert.equal(flashcardState.selfReportedEasyCount, 1);
      assert.equal(flashcardState.objectiveCorrectCount, 0);
      assert.equal(flashcardState.objectiveIncorrectCount, 0);
      assert.deepEqual(await sideEffectCounts(prisma, userId), effectsBefore);
    } finally {
      if (userId) await prisma.user.deleteMany({ where: { id: userId } });
      if (otherUserId) await prisma.user.deleteMany({ where: { id: otherUserId } });
      if (lectureId) await prisma.lecture.deleteMany({ where: { id: lectureId } });
      await prisma.$disconnect();
    }
  },
);

async function sideEffectCounts(
  prisma: PrismaClient,
  userId: string,
): Promise<unknown[]> {
  const outbox = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::integer AS count
    FROM "PrivateD1SyncOutbox"
    WHERE "data"->>'userId' = ${userId}
  `;
  return [
    await prisma.studyEvent.count({ where: { userId } }),
    await prisma.studyDailyMetric.count({ where: { userId } }),
    outbox[0]?.count ?? 0,
    await prisma.studyPointsLedgerEntry.count({ where: { userId } }),
    await prisma.pointsLog.count({ where: { userId } }),
    await prisma.userAchievement.count({ where: { userId } }),
    await prisma.userGamificationLevel.count({ where: { userId } }),
    await prisma.userChallengeProgress.count({ where: { userId } }),
    await prisma.calendarEvent.count({ where: { userId } }),
    await prisma.integritySignal.count(),
    await prisma.challengeInstance.count(),
    await prisma.leaderboardSnapshot.count(),
  ];
}