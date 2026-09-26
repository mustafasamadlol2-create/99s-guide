import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import test from "node:test";
import { createRecallCandidateService } from "../server/features/recall/candidateService.js";
import { getPrompt29RecallPostgresGateUrl } from "./helpers/prompt29RecallPostgresGate.js";

const databaseUrl = getPrompt29RecallPostgresGateUrl();
const skipped = databaseUrl
  ? false
  : "Set the explicit Prompt 29 disposable-schema test markers to run.";

test(
  "Prompt 29 PostgreSQL candidate selection, privacy, issuance replay, and write budget",
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
        "StudyEvent",
        "FocusSession",
        "GroupFocusParticipantSummary",
      ]) {
        assert.ok(tableNames.has(table), `Expected migrated table ${table}.`);
      }
      assert.equal(
        await prisma.recallAttempt.count(),
        0,
        "The isolated candidate gate must start without Recall attempts.",
      );

      const user = await prisma.user.create({
        data: { email: `prompt29-${randomUUID()}@example.test` },
        select: { id: true },
      });
      userId = user.id;
      const otherUser = await prisma.user.create({
        data: { email: `prompt29-other-${randomUUID()}@example.test` },
        select: { id: true },
      });
      otherUserId = otherUser.id;
      const lecture = await prisma.lecture.create({
        data: {
          name: "Prompt 29 isolated Recall fixture",
          mainSubject: "Verification",
          trackMode: "test",
        },
        select: { id: true },
      });
      lectureId = lecture.id;
      const weakMcq = await prisma.mcq.create({
        data: {
          question: "Prompt 29 weak candidate",
          optionA: "A",
          optionB: "B",
          optionC: "C",
          optionD: "D",
          correctAnswer: "A",
          lectureId,
        },
        select: { id: true },
      });
      const successfulMcq = await prisma.mcq.create({
        data: {
          question: "Prompt 29 successful candidate",
          optionA: "A",
          optionB: "B",
          optionC: "C",
          optionD: "D",
          correctAnswer: "B",
          lectureId,
        },
        select: { id: true },
      });
      const malformedMcq = await prisma.mcq.create({
        data: {
          question: " ",
          optionA: "A",
          optionB: "B",
          optionC: "C",
          optionD: "D",
          correctAnswer: "A",
          lectureId,
        },
        select: { id: true },
      });
      const flashcard = await prisma.flashcard.create({
        data: {
          clinicalConcept: "Prompt 29 review candidate",
          explanation: "Canonical self-reported review fixture.",
          lectureId,
        },
        select: { id: true },
      });

      const evidenceAt = new Date("2026-09-26T11:55:00.000Z");
      await prisma.studyEvent.createMany({
        data: [
          studyEvent(userId, lectureId, weakMcq.id, null, evidenceAt, {
            correct: false,
          }),
          studyEvent(userId, lectureId, successfulMcq.id, null, evidenceAt, {
            correct: true,
          }),
          studyEvent(userId, lectureId, null, flashcard.id, evidenceAt, {
            quality: "AGAIN",
          }),
        ],
      });

      const service = createRecallCandidateService({ database: prisma });
      const asOf = new Date("2026-09-26T12:00:00.000Z");
      const sideEffectsBefore = await sideEffectCounts(prisma, userId);
      const attemptsBefore = await prisma.recallAttempt.count({
        where: { userId },
      });
      const statesBefore = await prisma.recallItemState.count({
        where: { userId },
      });

      const preview = await service.previewRecallCandidates({
        userId,
        asOf,
        limit: 50,
      });
      assert.equal(preview[0]?.itemId, weakMcq.id);
      assert.ok(preview.some(({ itemId }) => itemId === flashcard.id));
      assert.ok(!preview.some(({ itemId }) => itemId === malformedMcq.id));
      assert.equal(
        await prisma.recallAttempt.count({ where: { userId } }),
        attemptsBefore,
        "Preview must not create Recall attempts.",
      );
      assert.equal(
        await prisma.recallItemState.count({ where: { userId } }),
        statesBefore,
        "Preview must not update presentation state.",
      );
      assert.deepEqual(await sideEffectCounts(prisma, userId), sideEffectsBefore);

      await assert.rejects(
        service.selectRecallCandidate({ userId: otherUserId, asOf }),
        { code: "NO_RECALL_CANDIDATE" },
      );

      const issuanceContext = {
        userId,
        asOf,
        issuanceIdempotencyKey: `prompt29-issue-${randomUUID()}`,
        selectionContextId: `study-block-${randomUUID()}`,
      };
      const issued = await service.selectAndIssueRecallCandidate(issuanceContext);
      assert.equal(issued.itemType, "MCQ");
      assert.equal(issued.itemId, weakMcq.id);
      assert.equal(issued.lectureId, lectureId);
      assert.equal(
        await prisma.recallAttempt.count({ where: { userId } }),
        attemptsBefore + 1,
      );
      const issuedState = await prisma.recallItemState.findUniqueOrThrow({
        where: {
          userId_itemType_itemId: {
            userId,
            itemType: "MCQ",
            itemId: weakMcq.id,
          },
        },
      });
      assert.equal(issuedState.presentationCount, 1);

      const replay = await service.selectAndIssueRecallCandidate(issuanceContext);
      assert.equal(replay.id, issued.id);
      assert.equal(
        await prisma.recallAttempt.count({ where: { userId } }),
        attemptsBefore + 1,
        "Replayed candidate issuance must not create a second attempt.",
      );
      assert.equal(
        (await prisma.recallItemState.findUniqueOrThrow({
          where: {
            userId_itemType_itemId: {
              userId,
              itemType: "MCQ",
              itemId: weakMcq.id,
            },
          },
        })).presentationCount,
        1,
      );
      assert.deepEqual(await sideEffectCounts(prisma, userId), sideEffectsBefore);

      await prisma.mcq.delete({ where: { id: malformedMcq.id } });
      const afterDelete = await service.previewRecallCandidates({
        userId,
        asOf,
        limit: 50,
      });
      assert.ok(!afterDelete.some(({ itemId }) => itemId === malformedMcq.id));
    } finally {
      if (userId) await prisma.user.deleteMany({ where: { id: userId } });
      if (otherUserId) await prisma.user.deleteMany({ where: { id: otherUserId } });
      if (lectureId) await prisma.lecture.deleteMany({ where: { id: lectureId } });
      await prisma.$disconnect();
    }
  },
);

function studyEvent(
  userId: string,
  lectureId: string,
  mcqId: string | null,
  flashcardId: string | null,
  occurredAt: Date,
  payload: Record<string, boolean | string>,
) {
  return {
    userId,
    lectureId,
    mcqId,
    flashcardId,
    eventType: mcqId ? "mcq_attempted" : "flashcard_reviewed",
    occurredAt,
    receivedAt: occurredAt,
    source: "backend",
    idempotencyKey: `prompt29-event-${randomUUID()}`,
    evidenceClass: "SERVER_VALIDATED",
    privacyClass: "PRIVATE_STUDY",
    payload,
  };
}

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