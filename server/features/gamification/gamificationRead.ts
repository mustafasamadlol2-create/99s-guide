import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { getUnifiedStudyPointsReadModel } from "../study-points/readModel.js";
import { assertValidStudyPointsUserId } from "../study-points/validation.js";
import { getMyAchievements } from "./achievementRead.js";
import { evaluateLifetimeLevel } from "./levelMath.js";
import { refreshUserAchievementProgressInTransaction } from "./achievementRefresh.js";
import { GAMIFICATION_METRIC_IDS } from "./constants.js";
import { GamificationError } from "./errors.js";
import { assertGamificationEnabled, isGamificationEnabled } from "./featureGate.js";
import {
  acquireUserGamificationLevelLock,
  readGamificationLevelView,
  refreshUserGamificationLevelInTransaction,
} from "./levelService.js";
import type {
  MyGamificationSummary,
  RefreshedGamificationState,
} from "./levelTypes.js";
import {
  acquireActiveGamificationRuleSetLock,
  getActiveGamificationRuleSet,
} from "./ruleSetService.js";

type GamificationDatabase = PrismaClient;

function pointMetricOverrides(
  points: Awaited<ReturnType<typeof getUnifiedStudyPointsReadModel>>,
): ReadonlyMap<string, number | boolean> {
  return new Map([
    [GAMIFICATION_METRIC_IDS.pointsTotal, points.totalPoints],
    [GAMIFICATION_METRIC_IDS.pointsFocus, points.focusPoints],
    [GAMIFICATION_METRIC_IDS.pointsMastery, points.masteryPoints],
    [GAMIFICATION_METRIC_IDS.pointsProgress, points.progressPoints],
    [GAMIFICATION_METRIC_IDS.pointsConsistency, points.consistencyPoints],
  ]);
}

export async function refreshUserGamificationState(
  userId: string,
  database: GamificationDatabase = getPrisma() as GamificationDatabase,
): Promise<RefreshedGamificationState & {
  rules: Awaited<ReturnType<typeof getActiveGamificationRuleSet>>;
}> {
  assertGamificationEnabled();
  assertValidStudyPointsUserId(userId);
  return database.$transaction(async (tx) => {
    await acquireActiveGamificationRuleSetLock(tx);
    await acquireUserGamificationLevelLock(tx, userId);
    const rules = await getActiveGamificationRuleSet(tx);
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new GamificationError(
        "GAMIFICATION_USER_NOT_FOUND",
        "The authenticated user does not exist.",
      );
    }
    const [{ now: asOf }] = await tx.$queryRaw<Array<{ now: Date }>>`
      SELECT CURRENT_TIMESTAMP AS now
    `;
    const points = await getUnifiedStudyPointsReadModel({ userId }, tx);
    const row = await refreshUserGamificationLevelInTransaction(
      tx,
      userId,
      rules,
      points.totalPoints,
      asOf,
    );
    const level = readGamificationLevelView(row, rules);
    if (!level) {
      throw new GamificationError(
        "GAMIFICATION_LEVEL_STATE_INVALID",
        "The refreshed Level projection failed source-definition validation.",
      );
    }
    const achievementRefresh = await refreshUserAchievementProgressInTransaction({
      userId,
      database,
      tx,
      rules,
      asOf,
      metricValueOverrides: pointMetricOverrides(points),
    });
    return {
      ruleSetVersion: rules.ruleSet.version,
      rules,
      level,
      points,
      achievementRefresh,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5_000,
    timeout: 20_000,
  });
}

export async function getMyGamificationSummary(
  userId: string,
  database: GamificationDatabase = getPrisma() as GamificationDatabase,
): Promise<MyGamificationSummary> {
  assertGamificationEnabled();
  assertValidStudyPointsUserId(userId);

  // Overview is a read path. Do not make it acquire advisory locks or mutate
  // rebuildable projections before it can render. Challenges already read
  // canonical metrics directly; Overview/Achievements now do the same.
  const [rules, points] = await Promise.all([
    getActiveGamificationRuleSet(database),
    getUnifiedStudyPointsReadModel({ userId }, database),
  ]);
  const asOf = new Date();
  const evaluated = evaluateLifetimeLevel(
    points.totalPoints,
    rules.definitions.levelDefinitions,
  );
  const level = {
    level: evaluated.definition.level,
    ...(evaluated.definition.titleKey
      ? { titleKey: evaluated.definition.titleKey }
      : {}),
    lifetimePoints: points.totalPoints,
    currentLevelMinimumPoints: evaluated.definition.minimumLifetimePoints,
    nextLevelMinimumPoints: evaluated.nextDefinition?.minimumLifetimePoints ?? null,
    pointsIntoLevel:
      points.totalPoints - evaluated.definition.minimumLifetimePoints,
    pointsToNextLevel: evaluated.nextDefinition
      ? evaluated.nextDefinition.minimumLifetimePoints - points.totalPoints
      : null,
    levelProgressRatio: evaluated.nextDefinition
      ? Math.min(
          1,
          Math.max(
            0,
            (points.totalPoints - evaluated.definition.minimumLifetimePoints)
              / (evaluated.nextDefinition.minimumLifetimePoints
                - evaluated.definition.minimumLifetimePoints),
          ),
        )
      : null,
    maxLevelReached: evaluated.maxLevelReached,
    ruleSetVersion: rules.ruleSet.version,
    lastEvaluatedAt: asOf.toISOString(),
  };
  let achievements: Awaited<ReturnType<typeof getMyAchievements>>;
  try {
    achievements = await getMyAchievements(userId, database, {
      // Supply a lightweight verified context so the achievement reader reuses
      // this exact active rule set without triggering projection refreshes.
      refreshResult: {
        ruleSetVersion: rules.ruleSet.version,
        asOf,
        achievementCount: rules.definitions.achievementDefinitions.length,
        newlyUnlockedCount: 0,
      },
      currentRules: rules,
      // The Summary request already paid for the canonical Points read. Reuse
      // it instead of opening another ledger transaction for points.total.
      metricValueOverrides: pointMetricOverrides(points),
    });
  } catch (error) {
    // Overview must still show the user's canonical Points + Level if an
    // optional achievement provider/history read is temporarily unavailable.
    console.warn(
      `[Gamification] Achievement section degraded during Overview read: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    achievements = {
      ruleSetVersion: rules.ruleSet.version,
      achievements: [],
      unlockHistory: [],
    };
  }

  return {
    ruleSetVersion: rules.ruleSet.version,
    points: {
      totalPoints: points.totalPoints,
      focusPoints: points.focusPoints,
      masteryPoints: points.masteryPoints,
      progressPoints: points.progressPoints,
      consistencyPoints: points.consistencyPoints,
      legacyLedgerPoints: points.legacyLedgerPoints,
      ledgerPoints: points.ledgerPoints,
      legacyPoints: points.legacyPoints,
    },
    level,
    achievements: achievements.achievements,
    unlockHistory: achievements.unlockHistory,
  };
}

export async function refreshUserGamificationBestEffort(
  userId: string,
  database: GamificationDatabase = getPrisma() as GamificationDatabase,
): Promise<void> {
  if (!isGamificationEnabled()) return;
  try {
    await refreshUserGamificationState(userId, database);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    console.warn(`[Gamification] Post-commit refresh failed: ${reason}`);
  }
}