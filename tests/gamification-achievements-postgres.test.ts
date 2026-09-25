import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { test } from "node:test";
import {
  activateGamificationRuleSet,
  ensureGamificationRuleSetDraft,
  getActiveGamificationRuleSet,
} from "../server/features/gamification/ruleSetService.js";
import {
  getMyAchievements,
  refreshUserAchievementProgress,
} from "../server/features/gamification/achievementService.js";
import { GAMIFICATION_V1_RULE_SET_VERSION } from "../server/features/gamification/definitions.js";
import { getPrompt23AchievementsPostgresGateUrl } from "./helpers/prompt23AchievementsPostgresGate.js";

const gateUrl = getPrompt23AchievementsPostgresGateUrl();

test("Prompt 23 PostgreSQL migration and achievement lifecycle", {
  skip: !gateUrl,
}, async () => {
  const disposableUrl = gateUrl!;
  execFileSync(
    "./node_modules/.bin/prisma",
    ["migrate", "deploy"],
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
  const email = `prompt23-${suffix}@example.invalid`;
  let userId: string | undefined;
  let concurrentUserId: string | undefined;
  let lectureId: string | undefined;
  try {
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
      assert.equal(active[0].version, GAMIFICATION_V1_RULE_SET_VERSION);
      await getActiveGamificationRuleSet(database);
    }

    const user = await database.user.create({ data: { email } });
    userId = user.id;
    const lecture = await database.lecture.create({
      data: {
        name: `Prompt 23 ${suffix}`,
        mainSubject: "Test",
        trackMode: "TEST",
      },
    });
    lectureId = lecture.id;
    const plan = await database.focusPlan.create({
      data: { userId, title: "Prompt 23 test plan", timezone: "UTC" },
    });
    const item = await database.focusPlanItem.create({
      data: {
        planId: plan.id,
        lectureId,
        sequence: 1,
        sessionCount: 1,
        focusDurationSeconds: 60,
        breakDurationSeconds: 0,
        includeMcq: false,
        includeFlashcards: false,
        includeVideo: false,
      },
    });

    const initial = await getMyAchievements(userId, database);
    assert.equal(initial.ruleSetVersion, GAMIFICATION_V1_RULE_SET_VERSION);
    assert.equal(initial.achievements.length, 3);
    assert.equal(initial.unlockHistory.length, 0);
    assert.ok(initial.achievements.every((achievement) =>
      achievement.visibility === "PRIVATE"
    ));
    assert.ok(initial.achievements.every((achievement) =>
      achievement.currentValue === 0
    ));

    const untouchedAt = new Date("2000-01-01T00:00:00.000Z");
    await database.userAchievementProgress.updateMany({
      where: { userId, ruleSetVersion: GAMIFICATION_V1_RULE_SET_VERSION },
      data: { updatedAt: untouchedAt, lastEvaluatedAt: untouchedAt },
    });
    await refreshUserAchievementProgress(userId, database);
    const afterNoop = await database.userAchievementProgress.findMany({
      where: { userId, ruleSetVersion: GAMIFICATION_V1_RULE_SET_VERSION },
    });
    assert.equal(afterNoop.length, 3);
    assert.ok(afterNoop.every((row) =>
      row.updatedAt.getTime() === untouchedAt.getTime()
    ));

    const endedAt = new Date(Date.now() - 30_000);
    const session = await database.focusSession.create({
      data: {
        userId,
        planId: plan.id,
        planItemId: item.id,
        lectureId,
        status: "COMPLETED",
        startedAt: new Date(endedAt.getTime() - 90_000),
        plannedEndAt: endedAt,
        actualEndedAt: endedAt,
        lastCheckpointAt: endedAt,
        activeSeconds: 60,
        pauseSeconds: 0,
        completionReason: "PLANNED_DURATION_ELAPSED",
        idempotencyKey: `prompt23-${suffix}`,
      },
    });
    const completed = await getMyAchievements(userId, database);
    const focusId = "achievement.focus.first_verified_session";
    const focusProgress = completed.achievements.find(
      ({ achievementId }) => achievementId === focusId,
    );
    assert.equal(focusProgress?.currentValue, 1);
    assert.equal(focusProgress?.progressCompleted, true);
    assert.equal(focusProgress?.unlocked, true);
    assert.equal(completed.unlockHistory.filter(
      ({ achievementId }) => achievementId === focusId,
    ).length, 1);

    await database.focusSession.update({
      where: { id: session.id },
      data: { status: "ABANDONED", activeSeconds: 0 },
    });
    const repaired = await getMyAchievements(userId, database);
    const repairedFocus = repaired.achievements.find(
      ({ achievementId }) => achievementId === focusId,
    );
    assert.equal(repairedFocus?.currentValue, 0);
    assert.equal(repairedFocus?.progressCompleted, false);
    assert.equal(repairedFocus?.unlocked, true);
    assert.equal(repaired.unlockHistory.filter(
      ({ achievementId }) => achievementId === focusId,
    ).length, 1);
    assert.equal(
      await database.userAchievement.count({ where: { userId, achievementId: focusId } }),
      1,
    );

    const concurrentUser = await database.user.create({
      data: { email: `prompt23-concurrent-${suffix}@example.invalid` },
    });
    concurrentUserId = concurrentUser.id;
    const concurrentPlan = await database.focusPlan.create({
      data: {
        userId: concurrentUser.id,
        title: "Prompt 23 concurrent plan",
        timezone: "UTC",
      },
    });
    const concurrentItem = await database.focusPlanItem.create({
      data: {
        planId: concurrentPlan.id,
        lectureId,
        sequence: 1,
        sessionCount: 1,
        focusDurationSeconds: 60,
        breakDurationSeconds: 0,
        includeMcq: false,
        includeFlashcards: false,
        includeVideo: false,
      },
    });
    await database.focusSession.create({
      data: {
        userId: concurrentUser.id,
        planId: concurrentPlan.id,
        planItemId: concurrentItem.id,
        lectureId,
        status: "COMPLETED",
        startedAt: new Date(endedAt.getTime() - 90_000),
        plannedEndAt: endedAt,
        actualEndedAt: endedAt,
        activeSeconds: 60,
        pauseSeconds: 0,
        completionReason: "PLANNED_DURATION_ELAPSED",
        idempotencyKey: `prompt23-concurrent-${suffix}`,
      },
    });
    await Promise.all([
      refreshUserAchievementProgress(concurrentUser.id, database),
      refreshUserAchievementProgress(concurrentUser.id, database),
    ]);
    assert.equal(
      await database.userAchievement.count({
        where: { userId: concurrentUser.id, achievementId: focusId },
      }),
      1,
    );
    assert.equal(
      await database.userAchievementProgress.count({
        where: {
          userId: concurrentUser.id,
          achievementId: focusId,
          ruleSetVersion: GAMIFICATION_V1_RULE_SET_VERSION,
        },
      }),
      1,
    );
  } finally {
    if (concurrentUserId) {
      await database.focusSession.deleteMany({
        where: { userId: concurrentUserId },
      });
      await database.focusPlan.deleteMany({
        where: { userId: concurrentUserId },
      });
      await database.user.deleteMany({ where: { id: concurrentUserId } });
    }
    if (userId) {
      await database.focusSession.deleteMany({ where: { userId } });
      await database.focusPlan.deleteMany({ where: { userId } });
      await database.user.deleteMany({ where: { id: userId } });
    }
    if (lectureId) {
      await database.lecture.deleteMany({ where: { id: lectureId } });
    }
    await database.$disconnect();
  }
});