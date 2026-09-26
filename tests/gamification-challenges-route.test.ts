import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import test from "node:test";
import { createChallengesRouter } from "../server/routes/challenges.js";
import type { MyChallengesResponse } from "../server/features/gamification/challengeTypes.js";

function responseFor(userId: string): MyChallengesResponse {
  const startsAt = new Date("2026-09-28T00:00:00.000Z");
  const endsAt = new Date("2026-10-05T00:00:00.000Z");
  return {
    ruleSetVersion: "gamification-v1",
    currentPeriod: {
      periodKey: "2026-09-28",
      startsAt,
      endsAt,
    },
    active: [{
      instanceId: `instance-${userId}`,
      definitionId: "challenge.focus.weekly_3_sessions",
      ruleSetVersion: "gamification-v1",
      periodKey: "2026-09-28",
      titleKey: "challenge.title",
      descriptionKey: "challenge.description",
      metricId: "focus.completed_sessions",
      current: 1,
      target: 3,
      progressRatio: 1 / 3,
      status: "ACTIVE",
      startsAt,
      endsAt,
      completedAt: null,
      expiredAt: null,
    }],
    recent: [],
  };
}

async function withServer(
  requireUser: RequestHandler,
  getMyChallenges: (userId: string) => Promise<MyChallengesResponse>,
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(
    "/api/me/challenges",
    createChallengesRouter({ requireUser, getMyChallenges }),
  );
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
}

test("own Challenges route uses only the authenticated user and is private", async () => {
  let receivedUserId = "";
  const requireUser: RequestHandler = (req, _res, next) => {
    (req as typeof req & { user: { id: string } }).user = { id: "authenticated-user" };
    next();
  };
  await withServer(
    requireUser,
    async (userId) => {
      receivedUserId = userId;
      return responseFor(userId);
    },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/me/challenges?userId=another-user`,
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store, private");
      const body = await response.json() as MyChallengesResponse;
      assert.equal(receivedUserId, "authenticated-user");
      assert.equal(body.active[0]?.instanceId, "instance-authenticated-user");
      assert.equal("userId" in body, false);
    },
  );
});

test("own Challenges route requires authentication and exposes no public user path", async () => {
  let called = false;
  const requireUser: RequestHandler = (_req, res) => {
    res.status(401).json({ error: "Unauthenticated" });
  };
  await withServer(
    requireUser,
    async () => {
      called = true;
      return responseFor("unexpected");
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/me/challenges`);
      assert.equal(response.status, 401);
      const publicResponse = await fetch(
        `${baseUrl}/api/users/another-user/challenges`,
      );
      assert.equal(publicResponse.status, 404);
      assert.equal(called, false);
    },
  );
});