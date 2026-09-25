import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { getGamificationMetricDefinition } from "./metricRegistry.js";
import { isGamificationThresholdMet } from "./thresholds.js";
import { GamificationError } from "./errors.js";
import { getGamificationRuleSetVersion } from "./ruleSetService.js";
import { refreshUserAchievementProgress } from "./achievementRefresh.js";
import {
  achievementDefinitionsFor,
  assertDefinitionFitsUnlock,
  decodeMetricValue,
} from "./achievementValues.js";
import type {
  MyAchievementUnlockView,
  MyAchievementView,
} from "./achievementTypes.js";
import type { AchievementRefreshResult } from "./achievementTypes.js";
import type { GamificationRuleSetWithDefinition } from "./types.js";

type AchievementDatabase = PrismaClient;

export type MyAchievementsReadOptions = {
  refreshResult?: AchievementRefreshResult;
  currentRules?: GamificationRuleSetWithDefinition;
};

export async function getMyAchievements(
  userId: string,
  database: AchievementDatabase = getPrisma() as AchievementDatabase,
  options?: MyAchievementsReadOptions,
): Promise<{
  ruleSetVersion: string;
  achievements: MyAchievementView[];
  unlockHistory: MyAchievementUnlockView[];
}> {
  if (Boolean(options?.refreshResult) !== Boolean(options?.currentRules)) {
    throw new GamificationError(
      "GAMIFICATION_INVALID_INPUT",
      "Pre-refreshed achievement reads require both the refresh result and verified rules.",
    );
  }
  const refreshed = options?.refreshResult
    ?? await refreshUserAchievementProgress(userId, database);
  const rules = options?.currentRules
    ?? await getGamificationRuleSetVersion(refreshed.ruleSetVersion, database);
  if (rules.ruleSet.version !== refreshed.ruleSetVersion) {
    throw new GamificationError(
      "GAMIFICATION_ACTIVE_RULE_SET_INVARIANT_FAILED",
      "Achievement refresh and read rule-set versions do not match.",
    );
  }
  const definitions = achievementDefinitionsFor(rules);
  const [progressRows, unlockRows] = await Promise.all([
    database.userAchievementProgress.findMany({
      where: { userId, ruleSetVersion: refreshed.ruleSetVersion },
      orderBy: [{ achievementId: "asc" }],
    }),
    database.userAchievement.findMany({
      where: { userId },
      orderBy: [{ unlockedAt: "asc" }, { achievementId: "asc" }],
    }),
  ]);
  const progressById = new Map(progressRows.map((row) => [row.achievementId, row]));
  const ruleSetVersions = [...new Set(
    unlockRows.map((row) => row.unlockedUnderRuleSetVersion),
  )];
  const historicalRuleSets = new Map<string, GamificationRuleSetWithDefinition>();
  for (const version of ruleSetVersions) {
    historicalRuleSets.set(version, await getGamificationRuleSetVersion(version, database));
  }

  const unlockDefinitions = new Map<string, {
    definition: (typeof definitions)[number];
  }>();
  for (const unlock of unlockRows) {
    const unlockRules = historicalRuleSets.get(unlock.unlockedUnderRuleSetVersion);
    if (!unlockRules) {
      throw new GamificationError(
        "GAMIFICATION_ACHIEVEMENT_RECORD_INVALID",
        `Unlock ${unlock.achievementId} has no verified rule-set version.`,
      );
    }
    const definition = assertDefinitionFitsUnlock(unlock, unlockRules);
    unlockDefinitions.set(
      `${unlock.unlockedUnderRuleSetVersion}:${unlock.achievementId}`,
      { definition },
    );
  }

  const activeUnlockById = new Map(
    unlockRows.map((row) => [row.achievementId, row]),
  );
  const achievements = definitions.map((definition): MyAchievementView => {
    const progress = progressById.get(definition.id);
    if (!progress) {
      throw new GamificationError(
        "GAMIFICATION_ACHIEVEMENT_PROGRESS_MISSING",
        `Active progress for ${definition.id} was not persisted.`,
      );
    }
    const metric = getGamificationMetricDefinition(definition.metricId);
    const currentValue = decodeMetricValue(
      progress.currentValue,
      progress.valueType,
      definition.id,
    );
    const targetValue = decodeMetricValue(
      progress.targetValue,
      progress.valueType,
      definition.id,
    );
    if (
      progress.metricId !== definition.metricId
      || progress.valueType !== metric.valueType
      || isGamificationThresholdMet(currentValue, definition.threshold)
        !== progress.completed
      || targetValue !== definition.threshold
    ) {
      throw new GamificationError(
        "GAMIFICATION_ACHIEVEMENT_PROGRESS_INVALID",
        `Active progress for ${definition.id} does not match its verified definition.`,
      );
    }
    const unlock = activeUnlockById.get(definition.id);
    return {
      achievementId: definition.id,
      ruleSetVersion: definition.ruleSetVersion,
      metricId: definition.metricId,
      titleKey: definition.titleKey,
      descriptionKey: definition.descriptionKey,
      visibility: definition.visibility,
      ...(definition.tier ? { tier: definition.tier } : {}),
      sortOrder: definition.sortOrder,
      currentValue,
      targetValue,
      progressCompleted: progress.completed,
      unlocked: Boolean(unlock),
      lastEvaluatedAt: progress.lastEvaluatedAt.toISOString(),
      unlockedAt: unlock?.unlockedAt.toISOString() ?? null,
      unlockedUnderRuleSetVersion: unlock?.unlockedUnderRuleSetVersion ?? null,
    };
  });

  const unlockHistory = unlockRows.map((unlock): MyAchievementUnlockView => {
    const resolved = unlockDefinitions.get(
      `${unlock.unlockedUnderRuleSetVersion}:${unlock.achievementId}`,
    );
    if (!resolved) {
      throw new GamificationError(
        "GAMIFICATION_ACHIEVEMENT_RECORD_INVALID",
        `Unlock ${unlock.achievementId} could not be resolved.`,
      );
    }
    return {
      achievementId: unlock.achievementId,
      unlockedUnderRuleSetVersion: unlock.unlockedUnderRuleSetVersion,
      metricId: unlock.metricId,
      titleKey: resolved.definition.titleKey,
      descriptionKey: resolved.definition.descriptionKey,
      visibility: resolved.definition.visibility,
      ...(resolved.definition.tier ? { tier: resolved.definition.tier } : {}),
      metricValueAtUnlock: decodeMetricValue(
        unlock.metricValueAtUnlock,
        unlock.valueType,
        unlock.achievementId,
      ),
      targetValueAtUnlock: decodeMetricValue(
        unlock.targetValueAtUnlock,
        unlock.valueType,
        unlock.achievementId,
      ),
      unlockedAt: unlock.unlockedAt.toISOString(),
    };
  });
  return {
    ruleSetVersion: refreshed.ruleSetVersion,
    achievements,
    unlockHistory,
  };
}