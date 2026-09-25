import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { test } from "node:test";
import {
  activateGamificationRuleSet,
  ensureGamificationRuleSetDraft,
  registerGamificationRuleSetDraftForBundle,
} from "../server/features/gamification/ruleSetService.js";
import {
  getMyGamificationSummary,
  reconcileUserGamificationLevel,
  refreshUserGamificationLevel,
} from "../server/features/gamification/achievementService.js";
import {
  GAMIFICATION_V1_RULE_SET_VERSION,
  getGamificationDefinitionBundle,
} from "../server/features/gamification/definitions.js";
import type { GamificationDefinitionBundle } from "../server/features/gamification/types.js";
import { getPrompt24LevelsPostgresGateUrl } from "./helpers/prompt24LevelsPostgresGate.js";

const gateUrl = getPrompt24LevelsPostgresGateUrl();

test("Prompt 24 disposable PostgreSQL Level projection lifecycle", {
  skip: !gateUrl,
}, async () => {
  const disposableUrl = gateUrl!;
  execFileSync(
    "./node_modules/.bin/prisma",
    ["migrate", "reset", "--force"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: disposableUrl,
        DIRECT_URL: disposableUrl,
      },
      stdio: "pipe",
    },
  );

  const database = new PrismaClient({
    datasources: { db: { url: disposableUrl } },
  });
  const suffix = randomUUID();
  const email = `prompt24-${suffix}@example.invalid`;
  const priorReadMode = process.env.STUDY_POINTS_READ_MODE;
  let userId: string | undefined;
  let missingUserId: string | undefined;
  try {
    process.env.STUDY_POINTS_READ_MODE = "LEGACY_ONLY";
    await database.$connect();
    await ensureGamificationRuleSetDraft(
      GAMIFICATION_V1_RULE_SET_VERSION,
      database,
    );
    const active = await database.gamificationRuleSet.findMany({
      where: { status: "ACTIVE" },
    });
    if (active.length === 0) {
      await activateGamificationRuleSet(
        GAMIFICATION_V1_RULE_SET_VERSION,
        database,
      );
    } else {
      assert.equal(active.length, 1);
      assert.equal(active[0]!.version, GAMIFICATION_V1_RULE_SET_VERSION);
    }

    const user = await database.user.create({ data: { email } });
    userId = user.id;
    const missingUser = await database.user.create({
      data: { email: `prompt24-missing-${suffix}@example.invalid` },
    });
    missingUserId = missingUser.id;
    assert.equal(
      (await reconcileUserGamificationLevel(missingUser.id, database)).status,
      "LEVEL_STATE_MISSING",
    );

    const pointsLog = await database.pointsLog.create({
      data: { userId, points: 100, reason: "Prompt 24 disposable Level fixture" },
    });
    const first = await getMyGamificationSummary(userId, database);
    assert.equal(first.points.totalPoints, 100);
    assert.equal(first.level.level, 2);
    assert.equal(first.level.currentLevelMinimumPoints, 100);
    assert.equal(first.level.pointsIntoLevel, 0);
    assert.equal(first.level.pointsToNextLevel, 150);
    assert.equal(
      (await reconcileUserGamificationLevel(userId, database)).status,
      "IN_SYNC",
    );
    assert.ok(first.unlockHistory.some((unlock) =>
      unlock.achievementId === "achievement.points.first_100"
    ));
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () =>
        getMyGamificationSummary(userId!, database)
      ),
    );
    assert.ok(concurrent.every((summary) =>
      summary.level.level === 2
      && summary.points.totalPoints === 100
    ));
    assert.equal(
      await database.userGamificationLevel.count({ where: { userId } }),
      1,
    );

    await database.pointsLog.update({
      where: { id: pointsLog.id },
      data: { points: 99 },
    });
    assert.equal(
      (await reconcileUserGamificationLevel(userId, database)).status,
      "LEVEL_STATE_STALE",
    );
    const reversed = await getMyGamificationSummary(userId, database);
    assert.equal(reversed.level.level, 1);
    assert.equal(reversed.points.totalPoints, 99);
    assert.ok(reversed.unlockHistory.some((unlock) =>
      unlock.achievementId === "achievement.points.first_100"
    ));
    const publicProfile = await (await import(
      "../server/features/gamification/publicProfile.js"
    )).getPublicGamificationProfile("viewer-test", userId, database);
    assert.deepEqual(publicProfile, {
      level: 1,
      maxLevelReached: false,
      achievements: [],
    });

    const testBundle = JSON.parse(JSON.stringify(
      getGamificationDefinitionBundle(GAMIFICATION_V1_RULE_SET_VERSION),
    )) as GamificationDefinitionBundle;
    (testBundle as { version: string }).version = "gamification-v2";
    (testBundle.achievementDefinitions as Array<
      GamificationDefinitionBundle["achievementDefinitions"][number]
    >).forEach((definition) => {
      (definition as { ruleSetVersion: string }).ruleSetVersion =
        "gamification-v2";
    });
    await registerGamificationRuleSetDraftForBundle(testBundle, database);
    await database.userGamificationLevel.update({
      where: { userId },
      data: {
        ruleSetVersion: "gamification-v2",
        definitionChecksum: "1".repeat(64),
      },
    });
    assert.equal(
      (await reconcileUserGamificationLevel(userId, database)).status,
      "RULE_VERSION_STALE",
    );
    await refreshUserGamificationLevel(userId, database);

    await database.userGamificationLevel.update({
      where: { userId },
      data: { level: 99 },
    });
    assert.equal(
      (await reconcileUserGamificationLevel(userId, database)).status,
      "INVALID_LEVEL_STATE",
    );
    await refreshUserGamificationLevel(userId, database);
    assert.equal(
      (await reconcileUserGamificationLevel(userId, database)).status,
      "IN_SYNC",
    );

    assert.equal(
      await database.userGamificationLevel.count({ where: { userId } }),
      1,
    );
    assert.equal(
      await database.userAchievement.count({
        where: { userId, achievementId: "achievement.points.first_100" },
      }),
      1,
    );
    assert.equal(
      await database.pointsLog.count({ where: { userId } }),
      1,
    );
  } finally {
    if (userId) {
      await database.user.deleteMany({ where: { id: userId } });
    }
    if (missingUserId) {
      await database.user.deleteMany({ where: { id: missingUserId } });
    }
    if (priorReadMode === undefined) {
      delete process.env.STUDY_POINTS_READ_MODE;
    } else {
      process.env.STUDY_POINTS_READ_MODE = priorReadMode;
    }
    await database.$disconnect();
  }
});