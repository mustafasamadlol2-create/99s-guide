import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { getStudyPointsReadModel } from "../study-points/readModel.js";
import { assertValidStudyPointsUserId } from "../study-points/validation.js";
import { getMyAchievements } from "./achievementRead.js";
import { refreshUserAchievementProgressInTransaction } from "./achievementRefresh.js";
import { GAMIFICATION_METRIC_IDS } from "./constants.js";
import { GamificationError } from "./errors.js";
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
  points: Awaited<ReturnType<typeof getStudyPointsReadModel>>,
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
    const points = await getStudyPointsReadModel({ userId }, database);
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
  const refreshed = await refreshUserGamificationState(userId, database);
  const achievements = await getMyAchievements(userId, database, {
    refreshResult: refreshed.achievementRefresh,
    currentRules: refreshed.rules,
  });
  if (achievements.ruleSetVersion !== refreshed.ruleSetVersion) {
    throw new GamificationError(
      "GAMIFICATION_ACTIVE_RULE_SET_INVARIANT_FAILED",
      "The private Gamification summary combines different rule-set versions.",
    );
  }
  return {
    ruleSetVersion: refreshed.ruleSetVersion,
    points: {
      totalPoints: refreshed.points.totalPoints,
      focusPoints: refreshed.points.focusPoints,
      masteryPoints: refreshed.points.masteryPoints,
      progressPoints: refreshed.points.progressPoints,
      consistencyPoints: refreshed.points.consistencyPoints,
      ledgerPoints: refreshed.points.ledgerPoints,
      legacyPoints: refreshed.points.legacyPoints,
    },
    level: refreshed.level,
    achievements: achievements.achievements,
    unlockHistory: achievements.unlockHistory,
  };
}

export async function refreshUserGamificationBestEffort(
  userId: string,
  database: GamificationDatabase = getPrisma() as GamificationDatabase,
): Promise<void> {
  try {
    await refreshUserGamificationState(userId, database);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    console.warn(`[Gamification] Post-commit refresh failed: ${reason}`);
  }
}