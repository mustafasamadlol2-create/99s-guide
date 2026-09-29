import type { UserAchievementProgress } from "@prisma/client";
import { GamificationError } from "./errors.js";
import { getGamificationMetricDefinition } from "./metricRegistry.js";
import {
  encodeMetricValue,
  type EncodedMetricValue,
} from "./achievementValues.js";
import { isGamificationThresholdMet } from "./thresholds.js";
import type { AchievementDefinition } from "./types.js";

export type AchievementProgressRow = Pick<
  UserAchievementProgress,
  | "id"
  | "achievementId"
  | "ruleSetVersion"
  | "metricId"
  | "valueType"
  | "currentValue"
  | "targetValue"
  | "completed"
>;

export type EvaluatedAchievementProgress = {
  definition: AchievementDefinition;
  current: EncodedMetricValue;
  target: EncodedMetricValue;
  completed: boolean;
  existing: AchievementProgressRow | undefined;
  unlocked: boolean;
  progressStatus: "MISSING" | "DRIFT" | "IN_SYNC";
  unlockReviewRequired: boolean;
};

export function evaluateAchievementProgress(input: {
  ruleSetVersion: string;
  definitions: readonly AchievementDefinition[];
  metricValues: ReadonlyMap<string, number | boolean>;
  existingProgress: readonly AchievementProgressRow[];
  unlockedAchievementIds: ReadonlySet<string>;
}): EvaluatedAchievementProgress[] {
  const progressByAchievement = new Map<string, AchievementProgressRow>();
  for (const row of input.existingProgress) {
    if (row.ruleSetVersion !== input.ruleSetVersion) {
      throw new GamificationError(
        "GAMIFICATION_ACHIEVEMENT_RECORD_INVALID",
        "Achievement progress belongs to a different rule-set version.",
      );
    }
    if (progressByAchievement.has(row.achievementId)) {
      throw new GamificationError(
        "GAMIFICATION_ACHIEVEMENT_RECORD_INVALID",
        "Duplicate progress rows were returned for one achievement.",
      );
    }
    progressByAchievement.set(row.achievementId, row);
  }

  return input.definitions.map((definition) => {
    if (definition.ruleSetVersion !== input.ruleSetVersion) {
      throw new GamificationError(
        "GAMIFICATION_ACHIEVEMENT_RECORD_INVALID",
        "Achievement definition belongs to a different rule-set version.",
      );
    }
    const rawValue = input.metricValues.get(definition.metricId);
    if (rawValue === undefined) {
      throw new GamificationError(
        "GAMIFICATION_METRIC_VALUE_INVALID",
        `Metric ${definition.metricId} was not evaluated.`,
      );
    }

    const metricDefinition = getGamificationMetricDefinition(definition.metricId);
    const current = encodeMetricValue(
      rawValue,
      metricDefinition.valueType,
      definition.id,
    );
    const target = encodeMetricValue(
      definition.threshold,
      metricDefinition.valueType,
      definition.id,
    );
    const completed = isGamificationThresholdMet(rawValue, definition.threshold);
    const existing = progressByAchievement.get(definition.id);
    const progressStatus = !existing
      ? "MISSING"
      : existing.metricId !== definition.metricId
        || existing.valueType !== current.valueType
        || existing.currentValue !== current.value
        || existing.targetValue !== target.value
        || existing.completed !== completed
        ? "DRIFT"
        : "IN_SYNC";
    const unlocked = input.unlockedAchievementIds.has(definition.id);

    return {
      definition,
      current,
      target,
      completed,
      existing,
      unlocked,
      progressStatus,
      unlockReviewRequired: completed && !unlocked,
    };
  });
}