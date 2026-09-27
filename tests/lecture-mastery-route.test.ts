import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import express, { type RequestHandler } from "express";
import { createMasteryRouter } from "../server/routes/mastery.js";

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

test("Mastery own-read uses only the authenticated user and disables caching", async () => {
  const app = express();
  const calls: Array<{ userId: string; lectureId: string }> = [];
  const requireUser: RequestHandler = (req, res, next) => {
    const userId = req.header("x-test-user");
    if (!userId) return res.status(401).json({ error: "Authentication required." });
    (req as AuthenticatedRequest).user = { id: userId };
    return next();
  };
  app.use("/api/me/mastery", createMasteryRouter({
    requireUser,
    getMyMastery: async (input) => {
      calls.push(input);
      return {
        lectureId: input.lectureId,
        state: "LEARNING",
        ruleVersion: "mastery-v1",
        lastEvaluatedAt: "2026-09-27T10:00:00.000Z",
        evidence: {
          objectiveAttempts: 3,
          objectiveCorrect: 2,
          objectiveAccuracyPercent: 66,
          flashcardReviews: 1,
          meaningfulFocusSeconds: 0,
          recallObjectiveAttempts: 1,
        },
      };
    },
  }));

  await withServer(app, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/me/mastery/lectures/lecture-7?userId=other-user`,
      { headers: { "x-test-user": "authenticated-user" } },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, private");
    assert.deepEqual(calls, [{
      userId: "authenticated-user",
      lectureId: "lecture-7",
    }]);
    assert.equal((await response.json()).lectureId, "lecture-7");
  });
});

test("Mastery own-read rejects unauthenticated requests before reading data", async () => {
  const app = express();
  let readCount = 0;
  const requireUser: RequestHandler = (_req, res) =>
    res.status(401).json({ error: "Authentication required." });
  app.use("/api/me/mastery", createMasteryRouter({
    requireUser,
    getMyMastery: async () => {
      readCount += 1;
      throw new Error("Must not be called without authentication.");
    },
  }));

  await withServer(app, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/me/mastery/lectures/lecture-7`,
    );
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store, private");
    assert.equal(readCount, 0);
  });
});