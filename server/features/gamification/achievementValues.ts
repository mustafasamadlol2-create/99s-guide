import { checksumGamificationDefinitionBundle } from "./checksum.js";
import { getGamificationMetricDefinition } from "./metricRegistry.js";
import { isGamificationThresholdMet } from "./thresholds.js";
import { GamificationError } from "./errors.js";
import type {
  AchievementDefinition,
  GamificationMetricValueType,
  GamificationRuleSetWithDefinition,
} from "./types.js";

export type EncodedMetricValue = {
  valueType: GamificationMetricValueType;
  value: bigint;
};

export function encodeMetricValue(
  value: number | boolean,
  valueType: GamificationMetricValueType,
  subject: string,
): EncodedMetricValue {
  if (valueType === "BOOLEAN") {
    if (typeof value !== "boolean") {
      throw new GamificationError(
        "GAMIFICATION_METRIC_VALUE_INVALID",
        `${subject} must be a boolean metric value.`,
      );
    }
    return { valueType, value: value ? 1n : 0n };
  }
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    throw new GamificationError(
      "GAMIFICATION_METRIC_VALUE_INVALID",
      `${subject} must be a nonnegative safe integer.`,
    );
  }
  return { valueType, value: BigInt(value) };
}

export function decodeMetricValue(
  value: bigint,
  valueType: string,
  subject: string,
): number | boolean {
  if (valueType === "BOOLEAN") {
    if (value !== 0n && value !== 1n) {
      throw new GamificationError(
        "GAMIFICATION_METRIC_VALUE_INVALID",
        `${subject} contains an invalid stored boolean encoding.`,
      );
    }
    return value === 1n;
  }
  if (valueType !== "INTEGER") {
    throw new GamificationError(
      "GAMIFICATION_METRIC_VALUE_INVALID",
      `${subject} contains an unknown stored metric type.`,
    );
  }
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new GamificationError(
      "GAMIFICATION_METRIC_VALUE_INVALID",
      `${subject} is outside the safe integer response range.`,
    );
  }
  return numeric;
}

export function achievementDefinitionsFor(
  ruleSet: GamificationRuleSetWithDefinition,
): AchievementDefinition[] {
  return [...ruleSet.definitions.achievementDefinitions].sort(
    (left, right) => left.sortOrder - right.sortOrder
      || left.id.localeCompare(right.id),
  );
}

export function uniqueAchievementMetricIds(
  definitions: readonly Pick<AchievementDefinition, "metricId">[],
): string[] {
  return [...new Set(definitions.map(({ metricId }) => metricId))];
}

export function assertDefinitionFitsUnlock(
  achievement: {
    achievementId: string;
    unlockedUnderRuleSetVersion: string;
    metricId: string;
    valueType: string;
    metricValueAtUnlock: bigint;
    targetValueAtUnlock: bigint;
    definitionChecksumAtUnlock: string;
  },
  rules: GamificationRuleSetWithDefinition,
): AchievementDefinition {
  const definition = rules.definitions.achievementDefinitions.find(
    (candidate) => candidate.id === achievement.achievementId,
  );
  if (!definition) {
    throw new GamificationError(
      "GAMIFICATION_ACHIEVEMENT_RECORD_INVALID",
      `Permanent unlock ${achievement.achievementId} is absent from its verified source definition.`,
    );
  }
  const metricDefinition = getGamificationMetricDefinition(definition.metricId);
  if (
    definition.ruleSetVersion !== achievement.unlockedUnderRuleSetVersion
    || definition.metricId !== achievement.metricId
    || metricDefinition.valueType !== achievement.valueType
    || encodeMetricValue(
      definition.threshold,
      metricDefinition.valueType,
      definition.id,
    ).value !== achievement.targetValueAtUnlock
    || checksumGamificationDefinitionBundle(rules.definitions)
      !== achievement.definitionChecksumAtUnlock
    || !isGamificationThresholdMet(
      decodeMetricValue(
        achievement.metricValueAtUnlock,
        achievement.valueType,
        definition.id,
      ),
      definition.threshold,
    )
  ) {
    throw new GamificationError(
      "GAMIFICATION_ACHIEVEMENT_RECORD_INVALID",
      `Permanent unlock ${achievement.achievementId} does not match its verified source definition.`,
    );
  }
  return definition;
}