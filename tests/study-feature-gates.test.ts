import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";

import {
  getClientVisibleStudyFeatureFlags,
} from "../server/features/study-core/featureFlags.js";
import { StudyPointsAwardEngine } from "../server/features/study-points/awardEngine.js";
import { StudyPointsLedgerService } from "../server/features/study-points/ledger.js";
import { createFocusService } from "../server/features/focus/service.js";
import {
  shouldAwardRecallStudyPoints,
} from "../server/features/recall/attemptService.js";
import {
  refreshUserGamificationBestEffort,
  refreshUserGamificationState,
} from "../server/features/gamification/gamificationRead.js";
import { refreshUserChallenges } from "../server/features/gamification/challengeRefresh.js";
import { createStudyFeatureFlagsRouter } from "../server/routes/studyFeatureFlags.js";

test("the public feature flag response exposes only the three client flags", async () => {
  const previous = new Map(
    [
      "STUDY_POINTS_ENABLED",
      "GAMIFICATION_ENABLED",
      "FOCUS_RESOURCE_HANDOFF_ENABLED",
    ].map((name) => [name, process.env[name]]),
  );
  process.env.STUDY_POINTS_ENABLED = "true";
  process.env.GAMIFICATION_ENABLED = "false";
  process.env.FOCUS_RESOURCE_HANDOFF_ENABLED = "yes";
  const app = express();
  app.use("/api", createStudyFeatureFlagsRouter());
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/study/features`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      STUDY_POINTS_ENABLED: true,
      GAMIFICATION_ENABLED: false,
      FOCUS_RESOURCE_HANDOFF_ENABLED: true,
    });
  } finally {
    server.close();
    await once(server, "close");
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  assert.deepEqual(
    getClientVisibleStudyFeatureFlags({
      STUDY_POINTS_ENABLED: "on",
      GAMIFICATION_ENABLED: "1",
      FOCUS_RESOURCE_HANDOFF_ENABLED: "invalid",
      RECALL_POINTS_ENABLED: "true",
    }),
    {
      STUDY_POINTS_ENABLED: true,
      GAMIFICATION_ENABLED: true,
      FOCUS_RESOURCE_HANDOFF_ENABLED: false,
    },
  );
});

test("disabled Study Points reject direct ledger and award service calls before database access", async () => {
  const calls: string[] = [];
  const database = {
    async $transaction() {
      calls.push("$transaction");
      throw new Error("database should not be accessed");
    },
  } as unknown as PrismaClient;
  const ledger = new StudyPointsLedgerService(database, () => false);
  const awarder = new StudyPointsAwardEngine(
    database,
    () => new Date("2026-10-01T00:00:00.000Z"),
    () => false,
  );

  await assert.rejects(
    ledger.getStudyPointsBalance("user-1"),
    (error: unknown) => (error as { code?: string }).code === "FEATURE_DISABLED",
  );
  await assert.rejects(
    awarder.awardStudyPointsForSource({
      userId: "user-1",
      sourceType: "FOCUS_SESSION",
      sourceId: "session-1",
    }),
    (error: unknown) => (error as { code?: string }).code === "FEATURE_DISABLED",
  );
  assert.deepEqual(calls, []);
});

test("disabled Gamification skips refresh and challenge evaluation work", async () => {
  const previous = process.env.GAMIFICATION_ENABLED;
  process.env.GAMIFICATION_ENABLED = "false";
  let transactions = 0;
  const database = {
    async $transaction() {
      transactions += 1;
      throw new Error("database should not be accessed");
    },
  } as unknown as PrismaClient;
  try {
    await assert.rejects(
      refreshUserGamificationState("user-1", database),
      (error: unknown) => (error as { code?: string }).code === "FEATURE_DISABLED",
    );
    await assert.rejects(
      refreshUserChallenges({ userId: "user-1" }, database as never),
      (error: unknown) => (error as { code?: string }).code === "FEATURE_DISABLED",
    );
    await refreshUserGamificationBestEffort("user-1", database);
    assert.equal(transactions, 0);
  } finally {
    if (previous === undefined) delete process.env.GAMIFICATION_ENABLED;
    else process.env.GAMIFICATION_ENABLED = previous;
  }
});

test("Focus blocks starting a handoff when disabled and Recall needs both reward flags", async () => {
  const focus = createFocusService({
    repository: {} as never,
    studyPointsAwarder: {
      async awardStudyPointsForSource() {
        throw new Error("points should not be awarded");
      },
    } as never,
    isFocusEnabled: () => true,
    isStudyEventsEnabled: () => true,
    isResourceHandoffEnabled: () => false,
  });
  await assert.rejects(
    focus.startResourceHandoff("user-1", "session-1", {
      resourceType: "PDF",
      resourceId: "resource-1",
      idempotencyKey: "handoff-1",
      source: "web",
    }),
    (error: unknown) => (error as { code?: string }).code === "FEATURE_DISABLED",
  );

  assert.equal(shouldAwardRecallStudyPoints(true, true), true);
  assert.equal(shouldAwardRecallStudyPoints(false, true), false);
  assert.equal(shouldAwardRecallStudyPoints(true, false), false);
  assert.equal(shouldAwardRecallStudyPoints(false, false), false);
});
