import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import express, { type RequestHandler } from "express";
import { test } from "node:test";
import { createServer } from "node:http";
import {
  decodeMetricValue,
  encodeMetricValue,
  uniqueAchievementMetricIds,
} from "../server/features/gamification/achievementValues.js";
import { getGamificationDefinitionBundle } from "../server/features/gamification/definitions.js";
import { createAchievementsRouter } from "../server/routes/achievements.js";
import {
  notifyStudyPointsPostCommit,
  setStudyPointsPostCommitHook,
} from "../server/features/study-points/postCommitHooks.js";

test("integer achievement progress uses exact bigint storage without float conversion", () => {
  const source = Number.MAX_SAFE_INTEGER;
  const encoded = encodeMetricValue(source, "INTEGER", "test achievement");
  assert.equal(encoded.value, BigInt(source));
  assert.equal(decodeMetricValue(encoded.value, encoded.valueType, "test"), source);
  assert.throws(
    () => encodeMetricValue(Number.MAX_SAFE_INTEGER + 1, "INTEGER", "test"),
    /safe integer/,
  );
});

test("boolean achievement progress has an explicit reversible 0/1 encoding", () => {
  assert.equal(encodeMetricValue(false, "BOOLEAN", "test").value, 0n);
  assert.equal(encodeMetricValue(true, "BOOLEAN", "test").value, 1n);
  assert.equal(decodeMetricValue(0n, "BOOLEAN", "test"), false);
  assert.equal(decodeMetricValue(1n, "BOOLEAN", "test"), true);
  assert.throws(() => decodeMetricValue(2n, "BOOLEAN", "test"), /boolean encoding/);
});

test("v1 achievements use the source-controlled Prompt 22 definitions only", () => {
  const bundle = getGamificationDefinitionBundle("gamification-v1");
  assert.deepEqual(
    bundle.achievementDefinitions.map(({ id, metricId, threshold }) => ({
      id,
      metricId,
      threshold,
    })),
    [
      {
        id: "achievement.focus.first_verified_session",
        metricId: "focus.completed_sessions",
        threshold: 1,
      },
      {
        id: "achievement.points.first_100",
        metricId: "points.total",
        threshold: 100,
      },
      {
        id: "achievement.group_focus.first_verified_run",
        metricId: "group_focus.completed_runs",
        threshold: 1,
      },
    ],
  );
  assert.ok(
    bundle.achievementDefinitions.every((definition) =>
      definition.visibility === "PRIVATE"
    ),
  );
  assert.ok(
    !bundle.achievementDefinitions.some(({ metricId }) =>
      metricId === "consistency.qualifying_days"
    ),
  );
  assert.deepEqual(
    bundle.levelDefinitions.map(({ level, minimumLifetimePoints }) => ({
      level,
      minimumLifetimePoints,
    })),
    [
      { level: 1, minimumLifetimePoints: 0 },
      { level: 2, minimumLifetimePoints: 100 },
      { level: 3, minimumLifetimePoints: 250 },
      { level: 4, minimumLifetimePoints: 500 },
      { level: 5, minimumLifetimePoints: 900 },
      { level: 6, minimumLifetimePoints: 1400 },
      { level: 7, minimumLifetimePoints: 2100 },
      { level: 8, minimumLifetimePoints: 3000 },
      { level: 9, minimumLifetimePoints: 4200 },
      { level: 10, minimumLifetimePoints: 5600 },
    ],
  );
  assert.deepEqual(bundle.challengeDefinitionContracts, []);
  assert.deepEqual(bundle.leaderboardDefinitionContracts, []);
});

test("achievement metric reads deduplicate shared metrics", () => {
  assert.deepEqual(
    uniqueAchievementMetricIds([
      { metricId: "points.total" },
      { metricId: "focus.completed_sessions" },
      { metricId: "points.total" },
    ]),
    ["points.total", "focus.completed_sessions"],
  );
});

test("Prompt 23 migration is additive, versioned, and contains no backfill", () => {
  const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
  const migration = readFileSync(
    resolve("prisma/migrations/20260925140000_user_achievement_state/migration.sql"),
    "utf8",
  );
  assert.match(schema, /model UserAchievementProgress\s*\{/);
  assert.match(schema, /model UserAchievement\s*\{/);
  assert.match(
    migration,
    /UNIQUE INDEX "ua_progress_user_achievement_version_key"\s+ON "UserAchievementProgress"\("userId", "achievementId", "ruleSetVersion"\)/,
  );
  assert.match(
    migration,
    /UNIQUE INDEX "ua_unlock_user_achievement_key"\s+ON "UserAchievement"\("userId", "achievementId"\)/,
  );
  assert.match(migration, /REFERENCES "GamificationRuleSet"\("version"\)/);
  assert.match(migration, /"currentValue" BIGINT NOT NULL/);
  assert.doesNotMatch(
    migration,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+"[^"]+"|DELETE\s+FROM)\b/gim,
  );
});

test("post-commit cosmetic listener failures do not propagate", async () => {
  setStudyPointsPostCommitHook(async () => {
    throw new Error("simulated cosmetic refresh failure");
  });
  try {
    await assert.doesNotReject(
      notifyStudyPointsPostCommit("test-user"),
    );
  } finally {
    setStudyPointsPostCommitHook(undefined);
  }
});

test("private achievements route always reads the authenticated user", async () => {
  const requestedUsers: string[] = [];
  const app = express();
  const requireUser: RequestHandler = (req, _res, next) => {
    (req as express.Request & { user: { id: string } }).user = { id: "owner-user" };
    next();
  };
  app.use("/api/me/achievements", createAchievementsRouter({
    requireUser,
    async getMyAchievements(userId) {
      requestedUsers.push(userId);
      return {
        ruleSetVersion: "gamification-v1",
        achievements: [],
        unlockHistory: [],
      };
    },
  }));
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(
      `${baseUrl}/api/me/achievements?userId=somebody-else`,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, private");
    assert.deepEqual(requestedUsers, ["owner-user"]);
    assert.deepEqual(await response.json(), {
      ruleSetVersion: "gamification-v1",
      achievements: [],
      unlockHistory: [],
    });

    const writeAttempt = await fetch(`${baseUrl}/api/me/achievements`, {
      method: "POST",
    });
    assert.equal(writeAttempt.status, 404);
    const otherUserRoute = await fetch(
      `${baseUrl}/api/users/somebody-else/achievements`,
    );
    assert.equal(otherUserRoute.status, 404);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("private achievements route does not call the reader without authentication", async () => {
  let readerCalled = false;
  const app = express();
  const requireUser: RequestHandler = (_req, res) =>
    res.status(401).json({ error: "Authentication required." });
  app.use("/api/me/achievements", createAchievementsRouter({
    requireUser,
    async getMyAchievements() {
      readerCalled = true;
      return {
        ruleSetVersion: "gamification-v1",
        achievements: [],
        unlockHistory: [],
      };
    },
  }));
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/me/achievements`,
    );
    assert.equal(response.status, 401);
    assert.equal(readerCalled, false);
  } finally {
    server.close();
    await once(server, "close");
  }
});