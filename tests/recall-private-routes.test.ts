import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import express, { type RequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";
import type { RecallAttemptService } from "../server/features/recall/types.js";
import { createRecallRouter } from "../server/routes/recall.js";

type AuthenticatedRequest = express.Request & {
  user?: { id?: string };
};

async function withServer(
  app: express.Express,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function createRequireUser(): RequestHandler {
  return (req, res, next) => {
    const id = req.header("x-test-user");
    if (!id) return res.status(401).json({ error: "Authentication required." });
    (req as AuthenticatedRequest).user = { id };
    return next();
  };
}

test("Recall eligibility is a private read and exposes no attempt or item identifiers", async () => {
  const previousFlag = process.env.SPACED_RECALL_ENABLED;
  process.env.SPACED_RECALL_ENABLED = "true";
  const now = new Date("2026-09-29T12:00:00.000Z");
  const activeAttempt = {
    id: "attempt-private",
    itemType: "MCQ",
    itemId: "mcq-private",
    lectureId: "lecture-private",
    issuanceSource: "PERIODIC",
    status: "PRESENTED",
    outcome: null,
    presentedAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
  };
  let transactionCount = 0;
  let userScope: unknown;
  const tx = {
    recallAttempt: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        userScope = where.userId;
        return where.status === "PRESENTED" ? activeAttempt : null;
      },
    },
  };
  const database = {
    $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => {
      transactionCount += 1;
      return callback(tx);
    },
    recallAttempt: { findFirst: async () => null },
    lecture: { findUnique: async () => null },
  } as unknown as PrismaClient;
  const app = express();
  app.use("/api/recall", createRecallRouter({
    requireUser: createRequireUser(),
    service: {} as RecallAttemptService,
    database,
    now: () => now,
  }));

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/recall/eligibility?itemId=attacker-selected`,
        { headers: { "x-test-user": "student-1" } },
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store, private");
      assert.deepEqual(await response.json(), { status: "ACTIVE_ATTEMPT" });
      assert.equal(userScope, "student-1");
      assert.equal(transactionCount, 1);
    });
  } finally {
    if (previousFlag === undefined) delete process.env.SPACED_RECALL_ENABLED;
    else process.env.SPACED_RECALL_ENABLED = previousFlag;
  }
});

test("Recall presentation scopes attempts to their owner and omits MCQ answer keys", async () => {
  const previousFlag = process.env.SPACED_RECALL_ENABLED;
  process.env.SPACED_RECALL_ENABLED = "true";
  const now = new Date("2026-09-29T12:00:00.000Z");
  const attempt = {
    id: "attempt-1",
    itemType: "MCQ",
    itemId: "mcq-1",
    lectureId: "lecture-1",
    issuanceSource: "PERIODIC",
    status: "PRESENTED",
    outcome: null,
    presentedAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
  };
  let attemptScope: unknown;
  const database = {
    $transaction: async () => { throw new Error("No transaction expected."); },
    recallAttempt: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        attemptScope = where.userId;
        return where.id === "attempt-1" ? attempt : null;
      },
    },
    lecture: {
      findUnique: async () => ({
        id: "lecture-1",
        title: "Private lecture",
        mcqs: [{
          id: "mcq-1",
          question: "Which option is correct?",
          optionA: "A",
          optionB: "B",
          optionC: "C",
          optionD: "D",
        }],
        flashcards: [],
      }),
    },
  } as unknown as PrismaClient;
  const app = express();
  app.use("/api/recall", createRecallRouter({
    requireUser: createRequireUser(),
    service: {} as RecallAttemptService,
    database,
    now: () => now,
  }));

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/recall/attempts/attempt-1`, {
        headers: { "x-test-user": "student-2" },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store, private");
      const body = await response.json() as Record<string, any>;
      assert.equal(attemptScope, "student-2");
      assert.equal(body.status, "PRESENTED");
      assert.deepEqual(body.item, {
        id: "mcq-1",
        question: "Which option is correct?",
        options: [
          { key: "A", text: "A" },
          { key: "B", text: "B" },
          { key: "C", text: "C" },
          { key: "D", text: "D" },
        ],
      });
      assert.doesNotMatch(JSON.stringify(body), /correctAnswer|explanation|answerKey/);
    });
  } finally {
    if (previousFlag === undefined) delete process.env.SPACED_RECALL_ENABLED;
    else process.env.SPACED_RECALL_ENABLED = previousFlag;
  }
});