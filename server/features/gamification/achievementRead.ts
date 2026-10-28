import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { getGamificationMetricDefinition } from "./metricRegistry.js";
import { isGamificationThresholdMet } from "./thresholds.js";
import { GamificationError } from "./errors.js";
import { assertGamificationEnabled } from "./featureGate.js";
import {
  getActiveGamificationRuleSet,
  getGamificationRuleSetVersion,
} from "./ruleSetService.js";
import { getGamificationMetricValue } from "./metrics.js";
import {
  achievementDefinitionsFor,
  assertDefinitionFitsUnlock,
  decodeMetricValue,
  uniqueAchievementMetricIds,
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
  /**
   * Values already read by a parent request (notably Overview). Reusing these
   * prevents duplicate ledger transactions and keeps Engagement reads bounded.
   */
  metricValueOverrides?: ReadonlyMap<string, number | boolean>;
};

/**
 * Student-facing Achievement reads must never depend on a rebuildable
 * UserAchievementProgress projection being present or perfectly synchronized.
 *
 * The previous implementation refreshed/persisted that projection on every GET
 * and then threw if a progress row was missing or drifted. Challenges use
 * canonical metric reads instead, which is why Challenges could keep working
 * while Overview/Achievements failed. This reader now follows the same model:
 * compute progress from canonical server-owned metrics and use permanent unlock
 * rows only as history. Projection refresh remains a background optimization.
 */
export async function getMyAchievements(
  userId: string,
  database: AchievementDatabase = getPrisma() as AchievementDatabase,
  options?: MyAchievementsReadOptions,
): Promise<{
  ruleSetVersion: string;
  achievements: MyAchievementView[];
  unlockHistory: MyAchievementUnlockView[];
}> {
  assertGamificationEnabled();
  if (Boolean(options?.refreshResult) !== Boolean(options?.currentRules)) {
    throw new GamificationError(
      "GAMIFICATION_INVALID_INPUT",
      "Pre-refreshed achievement reads require both the refresh result and verified rules.",
    );
  }

  const rules = options?.currentRules ?? await getActiveGamificationRuleSet(database);
  const asOf = options?.refreshResult?.asOf ?? new Date();
  const definitions = achievementDefinitionsFor(rules);

  const metricValues = new Map<string, number | boolean>();
  const metricIds = uniqueAchievementMetricIds(definitions);
  await Promise.all(metricIds.map(async (metricId) => {
    const definition = getGamificationMetricDefinition(metricId);
    const override = options?.metricValueOverrides?.get(metricId);
    if (override !== undefined) {
      metricValues.set(metricId, override);
      return;
    }
    if (!definition.available) {
      // An unavailable optional metric should not make the entire private
      // Engagement page unusable. Its milestone simply remains at zero/false.
      metricValues.set(metricId, definition.valueType === "BOOLEAN" ? false : 0);
      return;
    }
    try {
      const metric = await getGamificationMetricValue(
        { userId, metricId, asOf },
        database,
      );
      metricValues.set(metricId, metric.value);
    } catch (error) {
      // Keep independent achievements isolated. A Focus/Group-Focus provider
      // rollout issue must not hide Points-based achievements or Overview.
      console.warn(
        `[Achievements] Canonical metric ${metricId} could not be read: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      metricValues.set(metricId, definition.valueType === "BOOLEAN" ? false : 0);
    }
  }));

  // Unlock history is durable enhancement data, not a prerequisite for
  // rendering canonical progress. During a rolling migration or temporary DB
  // issue, keep Overview/Achievements usable and reconstruct visible progress
  // from server-owned metrics instead of failing the whole page.
  const unlockRows = await database.userAchievement.findMany({
    where: { userId },
    orderBy: [{ unlockedAt: "asc" }, { achievementId: "asc" }],
  }).catch((error) => {
    console.warn(
      `[Achievements] Unlock history could not be read; continuing without history: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return [];
  });
  const activeUnlockById = new Map(unlockRows.map((row) => [row.achievementId, row]));

  const achievements = definitions.map((definition): MyAchievementView => {
    const currentValue = metricValues.get(definition.metricId)
      ?? (typeof definition.threshold === "boolean" ? false : 0);
    const completed = isGamificationThresholdMet(currentValue, definition.threshold);
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
      rewardPoints: definition.rewardPoints ?? 0,
      currentValue,
      targetValue: definition.threshold,
      progressCompleted: completed,
      // Canonical verified completion is enough for the private UI to show the
      // milestone immediately; permanent unlock rows remain the durable history.
      unlocked: Boolean(unlock) || completed,
      lastEvaluatedAt: asOf.toISOString(),
      unlockedAt: unlock?.unlockedAt.toISOString() ?? (completed ? asOf.toISOString() : null),
      unlockedUnderRuleSetVersion:
        unlock?.unlockedUnderRuleSetVersion ?? (completed ? rules.ruleSet.version : null),
    };
  });

  const ruleSetVersions = [...new Set(
    unlockRows.map((row) => row.unlockedUnderRuleSetVersion),
  )];
  const historicalRuleSets = new Map<string, GamificationRuleSetWithDefinition>();
  for (const version of ruleSetVersions) {
    try {
      historicalRuleSets.set(version, await getGamificationRuleSetVersion(version, database));
    } catch (error) {
      console.warn(
        `[Achievements] Historical rule set ${version} could not be resolved: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  const unlockHistory: MyAchievementUnlockView[] = [];
  for (const unlock of unlockRows) {
    const unlockRules = historicalRuleSets.get(unlock.unlockedUnderRuleSetVersion);
    if (!unlockRules) continue;
    let definition: ReturnType<typeof achievementDefinitionsFor>[number];
    try {
      definition = assertDefinitionFitsUnlock(unlock, unlockRules);
    } catch (error) {
      console.warn(
        `[Achievements] Invalid unlock ${unlock.achievementId} was skipped: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      continue;
    }
    unlockHistory.push({
      achievementId: unlock.achievementId,
      unlockedUnderRuleSetVersion: unlock.unlockedUnderRuleSetVersion,
      metricId: unlock.metricId,
      titleKey: definition.titleKey,
      descriptionKey: definition.descriptionKey,
      visibility: definition.visibility,
      ...(definition.tier ? { tier: definition.tier } : {}),
      rewardPoints: definition.rewardPoints ?? 0,
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
    });
  }

  return {
    ruleSetVersion: rules.ruleSet.version,
    achievements,
    unlockHistory,
  };
}
