import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import type { PrismaClient } from "@prisma/client";
import test from "node:test";
import { createGamificationRouter } from "../server/routes/gamification.js";
import { createLeaderboardRouter } from "../server/routes/leaderboards.js";

test("public auth routes pass through API routers while their own routes stay protected", async () => {
  let authenticationChecks = 0;
  const requireUser: RequestHandler = (_req, res) => {
    authenticationChecks += 1;
    res.status(401).json({ error: "Authentication required." });
  };
  const app = express();

  app.use("/api", createGamificationRouter({
    requireUser,
    isEnabled: () => true,
    getMyGamificationSummary: async () => ({}) as never,
    getPublicGamificationProfile: async () => null,
  }));
  app.use("/api", createLeaderboardRouter({
    requireUser,
    database: {} as PrismaClient,
  }));
  app.get("/api/auth/oauth-url", (_req, res) => {
    res.json({ initialized: true });
  });

  const server: Server = createServer(app);
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  try {
    const address = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;

    const oauthResponse = await fetch(`${origin}/api/auth/oauth-url`);
    assert.equal(oauthResponse.status, 200);
    assert.deepEqual(await oauthResponse.json(), { initialized: true });
    assert.equal(authenticationChecks, 0);

    assert.equal(
      (await fetch(`${origin}/api/me/gamification`)).status,
      401,
    );
    assert.equal(
      (await fetch(`${origin}/api/leaderboards/WEEKLY`)).status,
      401,
    );
    assert.equal(authenticationChecks, 2);
  } finally {
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
    });
  }
});