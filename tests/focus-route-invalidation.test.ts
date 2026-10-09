import assert from "node:assert/strict";
import test from "node:test";
import express, { type RequestHandler } from "express";
import {
  createFocusRouter,
  type FocusInvalidationPayload,
} from "../server/routes/focus.js";

test("Focus broadcasts invalidation only after a successful mutation to the authenticated user", async () => {
  const invalidations: Array<{ userId: string; event: FocusInvalidationPayload }> = [];
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
    broadcastInvalidation: (userId, event) => invalidations.push({ userId, event }),
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
    assert.deepEqual(invalidations, []);

    const successResponse = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-user": "user-a",
        "x-focus-client-id": "focus-tab-identifier-01",
      },
      body: JSON.stringify({ idempotencyKey: "focus-test-key", source: "web" }),
    });
    assert.equal(successResponse.status, 200);
    assert.deepEqual(await successResponse.json(), {
      userId: "user-a",
      sessionId: "11111111-1111-4111-8111-111111111111",
    });
    assert.equal(invalidations.length, 1);
    assert.equal(invalidations[0].userId, "user-a");
    assert.deepEqual(invalidations[0].event.resources, ["current-session"]);
    assert.equal(
      invalidations[0].event.sessionId,
      "11111111-1111-4111-8111-111111111111",
    );
    assert.equal(
      invalidations[0].event.originClientId,
      "focus-tab-identifier-01",
    );
    assert.match(String(invalidations[0].event.eventId), /^[0-9a-f-]{36}$/i);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("terminal Focus mutations invalidate only the resources they change", async () => {
  const invalidations: FocusInvalidationPayload[] = [];
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
      async completeSession(_userId: string, sessionId: string) {
        return {
          idempotency: "FIRST_SEEN",
          session: { id: sessionId, status: "COMPLETED" },
        };
      },
    } as never,
    isGamificationEnabled: () => false,
    broadcastInvalidation: (_userId, event) => invalidations.push(event),
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
    await response.json();
    assert.equal(invalidations.length, 1);
    assert.deepEqual(invalidations[0].resources, [
      "current-session",
      "history",
      "metrics",
      "summary",
      "post-actions",
    ]);
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

test("Focus awaits post-commit Gamification and Challenge refreshes", async () => {
  let achievementsRefreshed = false;
  let challengesRefreshed = false;
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
    isGamificationEnabled: () => true,
    refreshAchievements: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      achievementsRefreshed = true;
    },
    refreshChallenges: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      challengesRefreshed = true;
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
    assert.equal(achievementsRefreshed, true);
    assert.equal(challengesRefreshed, true);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
