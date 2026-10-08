import assert from "node:assert/strict";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createFocusRouter } from "../server/routes/focus.js";

test("Focus broadcasts invalidation only after a successful mutation to the authenticated user", async () => {
  const invalidatedUsers: string[] = [];
  const requireUser: RequestHandler = (req, _res, next) => {
    (req as express.Request & { user: { id: string } }).user = {
      id: req.get("x-test-user") ?? "default-user",
    };
    next();
  };
  const service = {
    pauseSession: async (userId: string, sessionId: string) => ({
      userId,
      sessionId,
    }),
  };
  const app = express();
  app.use(express.json());
  app.use("/api/focus", createFocusRouter({
    requireUser,
    service: service as never,
    broadcastInvalidation: (userId) => invalidatedUsers.push(userId),
  }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}/api/focus/sessions/11111111-1111-4111-8111-111111111111/pause`;

  try {
    const invalidResponse = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-user": "user-a",
      },
      body: JSON.stringify({ idempotencyKey: "x", source: "web" }),
    });
    assert.equal(invalidResponse.status, 400);
    await invalidResponse.text();
    assert.deepEqual(invalidatedUsers, []);

    const successResponse = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-user": "user-a",
      },
      body: JSON.stringify({ idempotencyKey: "focus-test-key", source: "web" }),
    });
    assert.equal(successResponse.status, 200);
    assert.deepEqual(await successResponse.json(), {
      userId: "user-a",
      sessionId: "11111111-1111-4111-8111-111111111111",
    });
    assert.deepEqual(invalidatedUsers, ["user-a"]);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("Focus skips post-commit Gamification refreshes while Gamification is disabled", async () => {
  let achievementRefreshes = 0;
  let challengeRefreshes = 0;
  const requireUser: RequestHandler = (req, _res, next) => {
    (req as express.Request & { user: { id: string } }).user = {
      id: "focus-user",
    };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use("/api/focus", createFocusRouter({
    requireUser,
    service: {
      async completeSession() {
        return {
          idempotency: "FIRST_SEEN",
          session: {
            status: "COMPLETED",
            activeSeconds: 1_500,
            lectureId: "lecture-1",
          },
        };
      },
    } as never,
    isGamificationEnabled: () => false,
    refreshAchievements: async () => {
      achievementRefreshes += 1;
    },
    refreshChallenges: async () => {
      challengeRefreshes += 1;
    },
  }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/focus/sessions/11111111-1111-4111-8111-111111111111/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: "complete-test-key" }),
      },
    );
    assert.equal(response.status, 200);
    assert.equal(achievementRefreshes, 0);
    assert.equal(challengeRefreshes, 0);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
