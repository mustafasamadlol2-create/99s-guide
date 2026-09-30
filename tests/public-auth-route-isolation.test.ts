import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createGamificationRouter } from "../server/routes/gamification.js";
import { createLeaderboardRouter } from "../server/routes/leaderboards.js";

async function withServer(
  app: express.Express,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("/api-mounted study routers do not intercept public OAuth URL generation", async () => {
  let authCalls = 0;
  const requireUser: RequestHandler = (_req, res) => {
    authCalls += 1;
    res.status(401).json({ error: "Authentication required." });
  };

  const app = express();
  app.use(
    "/api",
    createGamificationRouter({
      requireUser,
      async getMyGamificationSummary() {
        throw new Error("not expected");
      },
      async getPublicGamificationProfile() {
        throw new Error("not expected");
      },
    }),
  );
  app.use(
    "/api",
    createLeaderboardRouter({
      requireUser,
      database: {} as never,
    }),
  );

  // In server.ts this public route is registered after the two /api-mounted
  // study routers. It must remain reachable without an existing session.
  app.get("/api/auth/oauth-url", (_req, res) => {
    res.json({ url: "https://accounts.google.com/o/oauth2/v2/auth" });
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/oauth-url?provider=google&code_challenge=${"a".repeat(43)}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      url: "https://accounts.google.com/o/oauth2/v2/auth",
    });
    assert.equal(authCalls, 0);
  });
});

test("gamification and leaderboard routes themselves remain protected", async () => {
  let authCalls = 0;
  const requireUser: RequestHandler = (_req, res) => {
    authCalls += 1;
    res.status(401).json({ error: "Authentication required." });
  };

  const app = express();
  app.use(
    "/api",
    createGamificationRouter({
      requireUser,
      async getMyGamificationSummary() {
        throw new Error("not expected");
      },
      async getPublicGamificationProfile() {
        throw new Error("not expected");
      },
    }),
  );
  app.use(
    "/api",
    createLeaderboardRouter({
      requireUser,
      database: {} as never,
    }),
  );

  await withServer(app, async (baseUrl) => {
    const gamification = await fetch(`${baseUrl}/api/me/gamification`);
    assert.equal(gamification.status, 401);

    const leaderboard = await fetch(`${baseUrl}/api/leaderboards/WEEKLY`);
    assert.equal(leaderboard.status, 401);

    assert.equal(authCalls, 2);
  });
});
