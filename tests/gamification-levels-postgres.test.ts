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
import { refreshUserGamificationBestEffort } from "../server/features/gamification/gamificationRead.js";
import {
  getMyGamificationSummary,
  reconcileUserGamificationLevel,
  refreshUserGamificationLevel,
} from "../server/features/gamification/achievementService.js";
import { refreshActiveLeaderboardSnapshotsForUser, buildLeaderboardSnapshot, getLatestLeaderboardSnapshot } from "../server/features/leaderboard/snapshots.js";
import { ensureLeaderboardSeason } from "../server/features/leaderboard/seasons.js";
import { getLeaderboardPage } from "../server/features/leaderboard/queries.js";
import { LEADERBOARD_ALL_TIME_RANKING_SEMANTICS_VERSION } from "../server/features/leaderboard/fingerprint.js";
import { StudyPointsLedgerService } from "../server/features/study-points/ledger.js";
import { reconcileStudyPointsAccount } from "../server/features/study-points/reconciliation.js";
import { setStudyPointsPostCommitHook } from "../server/features/study-points/postCommitHooks.js";
import { getUnifiedStudyPointsReadModel } from "../server/features/study-points/readModel.js";
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
  process.env.GAMIFICATION_ENABLED = "true";
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
  const priorStudyPointsEnabled = process.env.STUDY_POINTS_ENABLED;
  let userId: string | undefined;
  let missingUserId: string | undefined;
  let ledgerUserId: string | undefined;
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

    const user = await database.user.create({
      data: { email, totalPoints: 100 },
    });
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
    await database.user.update({
      where: { id: userId },
      data: { totalPoints: 99 },
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

    process.env.STUDY_POINTS_ENABLED = "true";
    const ledgerUser = await database.user.create({
      data: { email: `prompt24-ledger-${suffix}@example.invalid` },
    });
    ledgerUserId = ledgerUser.id;
    const ledger = new StudyPointsLedgerService(database);
    const allTimeSeason = await ensureLeaderboardSeason({
      scope: "ALL_TIME",
      asOf: new Date(),
    }, database);
    const initialSnapshot = await buildLeaderboardSnapshot({
      seasonId: allTimeSeason.id,
      snapshotType: "LIVE",
      now: new Date(),
      skipIfFresh: false,
    }, database);
    assert.ok(initialSnapshot.snapshot);
    await database.leaderboardSnapshot.update({
      where: { id: initialSnapshot.snapshot!.id },
      data: { rankingSemanticsVersion: "leaderboard-ranking-v1" },
    });
    const migratedPage = await getLeaderboardPage({
      viewerId: ledgerUserId,
      scope: "ALL_TIME",
      database,
    });
    assert.equal(migratedPage.isStale, false);
    const migratedSnapshot = await getLatestLeaderboardSnapshot(
      allTimeSeason.id,
      "LIVE",
      database,
    );
    assert.equal(
      migratedSnapshot?.rankingSemanticsVersion,
      LEADERBOARD_ALL_TIME_RANKING_SEMANTICS_VERSION,
    );
    setStudyPointsPostCommitHook(async (changedUserId) => {
      await refreshUserGamificationBestEffort(changedUserId, database);
      await refreshActiveLeaderboardSnapshotsForUser({
        userId: changedUserId,
      }, database);
    });

    const firstAward = await ledger.appendStudyPointsLedgerEntry({
      userId: ledgerUserId,
      amount: 100,
      category: "FOCUS",
      reasonCode: "focus.verified_completion",
      sourceType: "FOCUS_SESSION",
      sourceId: "prompt24-focus-award",
      ruleVersion: "focus-completion-v1",
      idempotencyKey: "prompt24-focus-award",
      effectiveAt: new Date(),
    });
    assert.equal(firstAward.replayed, false);
    const replay = await ledger.appendStudyPointsLedgerEntry({
      userId: ledgerUserId,
      amount: 100,
      category: "FOCUS",
      reasonCode: "focus.verified_completion",
      sourceType: "FOCUS_SESSION",
      sourceId: "prompt24-focus-award",
      ruleVersion: "focus-completion-v1",
      idempotencyKey: "prompt24-focus-award",
      effectiveAt: firstAward.entry.effectiveAt,
    });
    assert.equal(replay.replayed, true);
    const afterAward = await getMyGamificationSummary(ledgerUserId, database);
    assert.equal(afterAward.points.totalPoints, 100);
    assert.equal(afterAward.level.level, 2);
    assert.equal(
      (await getUnifiedStudyPointsReadModel({ userId: ledgerUserId }, database))
        .compatibilityMode,
      "LEGACY_PLUS_LEDGER",
    );
    const awardedSnapshot = await getLatestLeaderboardSnapshot(
      allTimeSeason.id,
      "LIVE",
      database,
    );
    assert.ok(awardedSnapshot);
    const awardedEntry = await database.leaderboardSnapshotEntry.findFirst({
      where: { snapshotId: awardedSnapshot!.id, userId: ledgerUserId },
    });
    assert.equal(awardedEntry?.score, 100n);
    assert.equal(awardedEntry?.levelSnapshot, 2);
    assert.equal(
      await database.userAchievement.count({
        where: {
          userId: ledgerUserId,
          achievementId: "achievement.points.first_100",
        },
      }),
      1,
    );

    await ledger.reverseStudyPointsLedgerEntry({
      userId: ledgerUserId,
      entryId: firstAward.entry.id,
      reasonCode: "admin.correction",
      ruleVersion: "admin-reversal-v1",
      idempotencyKey: "prompt24-focus-reversal",
      effectiveAt: new Date(),
    });
    const afterReversal = await getMyGamificationSummary(ledgerUserId, database);
    assert.equal(afterReversal.points.totalPoints, 0);
    assert.equal(afterReversal.level.level, 1);
    const reversedSnapshot = await getLatestLeaderboardSnapshot(
      allTimeSeason.id,
      "LIVE",
      database,
    );
    assert.ok(reversedSnapshot);
    assert.equal(
      await database.leaderboardSnapshotEntry.count({
        where: { snapshotId: reversedSnapshot!.id, userId: ledgerUserId },
      }),
      0,
    );

    await ledger.appendStudyPointsLedgerEntry({
      userId: ledgerUserId,
      amount: 250,
      category: "FOCUS",
      reasonCode: "focus.verified_completion",
      sourceType: "FOCUS_SESSION",
      sourceId: "prompt24-reconciliation-award",
      ruleVersion: "focus-completion-v1",
      idempotencyKey: "prompt24-reconciliation-award",
      effectiveAt: new Date(),
    });
    const beforeRepair = await getLatestLeaderboardSnapshot(
      allTimeSeason.id,
      "LIVE",
      database,
    );
    assert.ok(beforeRepair);
    await database.studyPointsBalanceProjection.update({
      where: { userId: ledgerUserId },
      data: {
        focusPoints: 0n,
        totalPoints: 0n,
        ledgerEntryCount: 0n,
      },
    });
    await database.userGamificationLevel.update({
      where: { userId: ledgerUserId },
      data: { lifetimePoints: 0n, level: 1, maxLevelReached: false },
    });
    const repaired = await reconcileStudyPointsAccount({
      userId: ledgerUserId,
      repairProjection: true,
    }, database);
    assert.equal(repaired.repaired, true);
    const afterRepair = await getMyGamificationSummary(ledgerUserId, database);
    assert.equal(afterRepair.points.totalPoints, 250);
    assert.equal(afterRepair.level.level, 3);
    const repairedProfile = await (await import(
      "../server/features/gamification/publicProfile.js"
    )).getPublicGamificationProfile("viewer-test", ledgerUserId, database);
    assert.equal(repairedProfile.level, 3);
    const repairedSnapshot = await getLatestLeaderboardSnapshot(
      allTimeSeason.id,
      "LIVE",
      database,
    );
    assert.ok(repairedSnapshot);
    assert.ok(repairedSnapshot!.generatedAt >= beforeRepair!.generatedAt);
    const repairedEntry = await database.leaderboardSnapshotEntry.findFirst({
      where: { snapshotId: repairedSnapshot!.id, userId: ledgerUserId },
    });
    assert.equal(repairedEntry?.score, 250n);
    assert.equal(repairedEntry?.levelSnapshot, 3);
    assert.equal(
      await database.userAchievement.count({
        where: {
          userId: ledgerUserId,
          achievementId: "achievement.points.first_100",
        },
      }),
      1,
    );

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
    testBundle.challengeDefinitionContracts.forEach((challenge) => {
      challenge.ruleSetVersion = "gamification-v2";
    });
    testBundle.leaderboardDefinitionContracts.forEach((leaderboard) => {
      leaderboard.ruleSetVersion = "gamification-v2";
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
    setStudyPointsPostCommitHook(undefined);
    if (ledgerUserId) {
      await database.user.deleteMany({ where: { id: ledgerUserId } });
    }
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
    if (priorStudyPointsEnabled === undefined) {
      delete process.env.STUDY_POINTS_ENABLED;
    } else {
      process.env.STUDY_POINTS_ENABLED = priorStudyPointsEnabled;
    }
    await database.$disconnect();
  }
});