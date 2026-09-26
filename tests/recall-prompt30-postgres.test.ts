import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import express, { type RequestHandler } from "express";
import { PrismaClient } from "@prisma/client";
import test from "node:test";
import { createRecallAttemptService } from "../server/features/recall/attemptService.js";
import {
  createRecallJsonParser,
  createRecallRouter,
} from "../server/routes/recall.js";
import { getPrompt30RecallPostgresGateUrl } from "./helpers/prompt30RecallPostgresGate.js";

const databaseUrl = getPrompt30RecallPostgresGateUrl();
const skipped = databaseUrl
  ? false
  : "Set the explicit Prompt 30 isolated PostgreSQL gate markers to run.";

test(
  "Prompt 30 protected launch, concurrency, cooldowns, token answer, and attempt caps",
  { skip: skipped },
  async () => {
    assert.ok(databaseUrl);
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    const environmentNames = [
      "SPACED_RECALL_ENABLED",
      "RECALL_POINTS_ENABLED",
      "STUDY_POINTS_ENABLED",
      "STUDY_INTEGRITY_ENABLED",
      "STUDY_EVENTS_ENABLED",
      "RECALL_INTERACTION_TOKEN_KEYS_JSON",
      "RECALL_INTERACTION_TOKEN_ACTIVE_KID",
    ] as const;
    const previousEnvironment = new Map(
      environmentNames.map((name) => [name, process.env[name]]),
    );
    let server: Server | undefined;
    let userId: string | undefined;
    let lectureId: string | undefined;
    let clock = new Date("2026-09-27T21:00:00.000Z");

    try {
      process.env.SPACED_RECALL_ENABLED = "true";
      process.env.RECALL_POINTS_ENABLED = "true";
      process.env.STUDY_POINTS_ENABLED = "true";
      process.env.STUDY_INTEGRITY_ENABLED = "false";
      process.env.STUDY_EVENTS_ENABLED = "false";
      process.env.RECALL_INTERACTION_TOKEN_KEYS_JSON = JSON.stringify({
        gate: Buffer.alloc(32, 29).toString("base64url"),
      });
      process.env.RECALL_INTERACTION_TOKEN_ACTIVE_KID = "gate";

      await prisma.$connect();
      const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = current_schema()
      `;
      const tableNames = new Set(tables.map(({ table_name }) => table_name));
      assert.ok(tableNames.has("RecallAttempt"));
      assert.ok(tableNames.has("RecallItemState"));
      const provenanceColumns = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'RecallAttempt'
          AND column_name IN ('issuanceSource', 'issuancePolicyVersion')
      `;
      assert.deepEqual(
        new Set(provenanceColumns.map(({ column_name }) => column_name)),
        new Set(["issuanceSource", "issuancePolicyVersion"]),
      );
      assert.equal(
        await prisma.recallAttempt.count(),
        0,
        "The Prompt 30 gate must use an empty isolated schema.",
      );

      const user = await prisma.user.create({
        data: { email: `prompt30-${randomUUID()}@example.test` },
        select: { id: true },
      });
      userId = user.id;
      const lecture = await prisma.lecture.create({
        data: {
          name: "Prompt 30 isolated Recall fixture",
          mainSubject: "Verification",
          trackMode: "test",
        },
        select: { id: true },
      });
      lectureId = lecture.id;

      const items = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          prisma.mcq.create({
            data: {
              question: `Prompt 30 protected candidate ${index + 1}`,
              optionA: "Correct",
              optionB: "Incorrect B",
              optionC: "Incorrect C",
              optionD: "Incorrect D",
              correctAnswer: "A",
              lectureId: lecture.id,
            },
            select: { id: true },
          })
        ),
      );
      const evidenceAt = new Date(clock.getTime() - 60_000);
      await prisma.studyEvent.createMany({
        data: items.map(({ id }) => ({
          userId: user.id,
          lectureId: lecture.id,
          mcqId: id,
          flashcardId: null,
          eventType: "mcq_attempted",
          occurredAt: evidenceAt,
          receivedAt: evidenceAt,
          source: "backend",
          idempotencyKey: `prompt30-study-${randomUUID()}`,
          evidenceClass: "SERVER_VALIDATED",
          privacyClass: "PRIVATE_STUDY",
          payload: { correct: false },
        })),
      });

      const service = createRecallAttemptService({
        database: prisma,
        now: () => clock,
      });
      const app = express();
      const requireUser: RequestHandler = (req, _res, next) => {
        Object.assign(req, { user: { id: user.id } });
        next();
      };
      app.use(createRecallJsonParser());
      app.use(
        "/api/recall",
        createRecallRouter({
          requireUser,
          service,
          database: prisma,
          now: () => clock,
        }),
      );
      server = createServer(app);
      await new Promise<void>((resolve, reject) => {
        server?.once("error", reject);
        server?.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const baseUrl = `http://127.0.0.1:${address.port}/api/recall`;

      const simultaneous = await Promise.all(
        Array.from({ length: 20 }, () => postJson(baseUrl, "/next", {})),
      );
      const firstBodies = simultaneous.map(({ body }) => body);
      const firstAttemptId = (firstBodies[0]?.attempt as { id?: string } | undefined)?.id;
      assert.ok(firstAttemptId);
      assert.ok(
        firstBodies.every(
          (body) =>
            (body.attempt as { id?: string } | undefined)?.id === firstAttemptId,
        ),
      );
      assert.equal(
        firstBodies.filter((body) => body.status === "AVAILABLE").length,
        1,
      );
      assert.equal(
        firstBodies.filter((body) => body.status === "ACTIVE_ATTEMPT").length,
        19,
      );
      const first = firstBodies[0]!;
      assert.equal(first.policyVersion, "recall-policy-v1");
      assert.equal("content" in (first.attempt as object), false);
      assert.equal("correctAnswer" in (first.attempt as object), false);
      const firstAttempt = first.attempt as {
        id: string;
        itemId: string;
      };
      const firstToken = first.interactionToken as string;
      assert.equal(
        await prisma.recallAttempt.count({
          where: { userId, issuanceSource: "PERIODIC" },
        }),
        1,
      );
      assert.equal(
        (
          await prisma.recallItemState.findUniqueOrThrow({
            where: {
              userId_itemType_itemId: {
                userId,
                itemType: "MCQ",
                itemId: firstAttempt.itemId,
              },
            },
          })
        ).presentationCount,
        1,
      );

      const missingTokenAnswer = await postJson(
        baseUrl,
        `/attempts/${firstAttempt.id}/answer`,
        { selectedOption: "A" },
      );
      assert.equal(missingTokenAnswer.response.status, 401);
      assert.equal(
        (
          await prisma.recallAttempt.findUniqueOrThrow({
            where: { id: firstAttempt.id },
          })
        ).status,
        "PRESENTED",
      );
      const correctAnswer = await postJson(
        baseUrl,
        `/attempts/${firstAttempt.id}/answer`,
        { selectedOption: "A" },
        firstToken,
      );
      assert.equal(correctAnswer.response.status, 200);
      assert.equal(correctAnswer.body.outcome, "CORRECT");
      assert.deepEqual(correctAnswer.body.reward, {
        awarded: true,
        points: 2,
      });

      const issued: Array<{ itemId: string; presentedAt: Date }> = [
        { itemId: firstAttempt.itemId, presentedAt: new Date(clock) },
      ];
      const dayMilliseconds = 24 * 60 * 60 * 1000;
      const cooldownMilliseconds = 4 * 60 * 60 * 1000;
      for (let day = 0; day < 4; day += 1) {
        const firstHourIndex = day === 0 ? 1 : 0;
        for (let issue = firstHourIndex; issue < 3; issue += 1) {
          clock = new Date(
            new Date("2026-09-27T21:00:00.000Z").getTime() +
              day * dayMilliseconds +
              issue * cooldownMilliseconds,
          );
          const next = await postJson(baseUrl, "/next", {});
          assert.equal(next.response.status, 200);
          assert.equal(next.body.status, "AVAILABLE");
          const attempt = next.body.attempt as { id: string; itemId: string };
          const presentedAt = new Date(clock);
          assert.equal(
            issued.some(
              (previous) =>
                previous.itemId === attempt.itemId &&
                presentedAt.getTime() - previous.presentedAt.getTime() <
                  72 * 60 * 60 * 1000,
            ),
            false,
            "An item presented within the prior 72 hours must be suppressed.",
          );
          issued.push({ itemId: attempt.itemId, presentedAt });
          const skipped = await postJson(
            baseUrl,
            `/attempts/${attempt.id}/skip`,
            {},
            next.body.interactionToken as string,
          );
          assert.equal(skipped.response.status, 200);
          assert.deepEqual(skipped.body.reward, {
            awarded: false,
            points: 0,
            reason: "NOT_OBJECTIVELY_CORRECT",
          });
        }

        clock = new Date(
          new Date("2026-09-27T21:00:00.000Z").getTime() +
            day * dayMilliseconds +
            12 * 60 * 60 * 1000,
        );
        const dailyLimit = await postJson(baseUrl, "/next", {});
        assert.equal(dailyLimit.body.status, "DAILY_LIMIT_REACHED");
      }

      clock = new Date("2026-10-01T21:00:00.000Z");
      const weeklyLimit = await postJson(baseUrl, "/next", {});
      assert.equal(weeklyLimit.body.status, "WEEKLY_LIMIT_REACHED");
      assert.equal(
        await prisma.recallAttempt.count({
          where: {
            userId,
            issuanceSource: "PERIODIC",
            issuancePolicyVersion: "recall-policy-v1",
          },
        }),
        12,
      );
      assert.equal(
        await prisma.studyPointsLedgerEntry.count({
          where: { userId, sourceType: "RECALL_ATTEMPT" },
        }),
        1,
      );
    } finally {
      if (server) {
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      }
      if (userId) await prisma.user.deleteMany({ where: { id: userId } });
      if (lectureId) await prisma.lecture.deleteMany({ where: { id: lectureId } });
      await prisma.$disconnect();
      for (const name of environmentNames) {
        const previous = previousEnvironment.get(name);
        if (previous === undefined) delete process.env[name];
        else process.env[name] = previous;
      }
    }
  },
);

async function postJson(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) headers["X-Recall-Interaction-Token"] = token;
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return {
    response,
    body: await response.json() as Record<string, unknown>,
  };
}