import {
  GAMIFICATION_DEFINITION_SCHEMA_VERSION,
  GAMIFICATION_METRIC_IDS,
  GAMIFICATION_POINT_CATEGORIES,
  GAMIFICATION_RULE_VERSION_PATTERN,
} from "./constants.js";
import { GamificationError } from "./errors.js";
import { getGamificationMetricDefinitions } from "./metricRegistry.js";
import type {
  GamificationDefinitionBundle,
  GamificationMetricDefinition,
} from "./types.js";

const TOP_LEVEL_KEYS = [
  "version",
  "schemaVersion",
  "pointCategories",
  "achievementDefinitions",
  "levelDefinitions",
  "challengeDefinitionContracts",
  "leaderboardDefinitionContracts",
];

const ACHIEVEMENT_KEYS = [
  "id",
  "ruleSetVersion",
  "metricId",
  "threshold",
  "tier",
  "titleKey",
  "descriptionKey",
  "visibility",
  "sortOrder",
];

const LEVEL_KEYS = ["level", "minimumLifetimePoints", "titleKey"];
const CHALLENGE_KEYS = [
  "id",
  "ruleSetVersion",
  "metricId",
  "target",
  "enrollmentPolicy",
  "windowPolicy",
  "titleKey",
  "descriptionKey",
  "visibility",
  "sortOrder",
];
const LEADERBOARD_KEYS = [
  "id",
  "ruleSetVersion",
  "period",
  "scoreMetricId",
];

const ID_PATTERN = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/u;
const LOCALIZATION_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/u;
const TIERS = new Set(["BRONZE", "SILVER", "GOLD"]);
const VISIBILITIES = new Set(["PRIVATE", "PROFILE_SAFE"]);
const CHALLENGE_ENROLLMENT_POLICIES = new Set(["AUTO", "MANUAL"]);
const CHALLENGE_WINDOW_POLICIES = new Set(["WEEKLY"]);
const CHALLENGE_VISIBILITIES = new Set(["PRIVATE_STUDY"]);
const CHALLENGE_WINDOW_METRIC_IDS = new Set<string>([
  GAMIFICATION_METRIC_IDS.focusCompletedSessions,
  GAMIFICATION_METRIC_IDS.focusVerifiedSeconds,
  GAMIFICATION_METRIC_IDS.groupFocusCompletedRuns,
  GAMIFICATION_METRIC_IDS.consistencyQualifyingDays,
]);
const LEADERBOARD_PERIODS = new Set(["WEEKLY", "MONTHLY", "ALL_TIME"]);

function invalid(message: string): never {
  throw new GamificationError("GAMIFICATION_DEFINITION_INVALID", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    invalid(`${label} has unsupported fields: ${unknown.join(", ")}.`);
  }
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function requireNonemptyString(
  value: unknown,
  label: string,
  maxLength = 128,
): asserts value is string {
  if (
    typeof value !== "string"
    || value.trim() !== value
    || value.length < 1
    || value.length > maxLength
  ) {
    invalid(`${label} must be a trimmed non-empty string of at most ${maxLength} characters.`);
  }
}

function requireNamespacedId(value: unknown, label: string): asserts value is string {
  requireNonemptyString(value, label, 128);
  if (!ID_PATTERN.test(value) || !value.includes(".")) {
    invalid(`${label} must be a namespaced stable identifier.`);
  }
}

function requireLocalizationKey(
  value: unknown,
  label: string,
): asserts value is string {
  requireNonemptyString(value, label, 160);
  if (!LOCALIZATION_KEY_PATTERN.test(value)) {
    invalid(`${label} must be a stable localization key.`);
  }
}

function metricRegistryMap(
  registry: readonly GamificationMetricDefinition[],
): Map<string, GamificationMetricDefinition> {
  const byId = new Map<string, GamificationMetricDefinition>();
  for (const metric of registry) {
    if (byId.has(metric.id)) invalid(`Duplicate metric registry ID: ${metric.id}.`);
    byId.set(metric.id, metric);
  }
  return byId;
}

function requireMetric(
  metricId: unknown,
  registry: Map<string, GamificationMetricDefinition>,
  label: string,
  requirePublic = false,
): GamificationMetricDefinition {
  requireNonemptyString(metricId, `${label}.metricId`);
  const definition = registry.get(metricId);
  if (!definition) invalid(`${label} references unknown metric ${metricId}.`);
  if (!definition.available) {
    invalid(`${label} references unavailable metric ${metricId}.`);
  }
  if (
    definition.privacyClass === "ADMIN_SECURITY"
    || definition.privacyClass === "SYSTEM_INTERNAL"
  ) {
    invalid(`${label} cannot use ${definition.privacyClass} metric ${metricId}.`);
  }
  if (requirePublic && definition.privacyClass !== "PROFILE_PUBLIC") {
    invalid(`${label} requires a PROFILE_PUBLIC source metric.`);
  }
  return definition;
}

function validateAchievementDefinitions(
  value: unknown,
  bundleVersion: string,
  registry: Map<string, GamificationMetricDefinition>,
  ids: Set<string>,
): void {
  if (!Array.isArray(value)) invalid("achievementDefinitions must be an array.");
  const sortOrders = new Set<number>();
  for (const [index, candidate] of value.entries()) {
    const label = `achievementDefinitions[${index}]`;
    if (!isRecord(candidate)) invalid(`${label} must be an object.`);
    assertExactKeys(candidate, ACHIEVEMENT_KEYS, label);
    requireNamespacedId(candidate.id, `${label}.id`);
    if (ids.has(candidate.id)) invalid(`Duplicate definition ID ${candidate.id}.`);
    ids.add(candidate.id);
    if (candidate.ruleSetVersion !== bundleVersion) {
      invalid(`${label}.ruleSetVersion must match the bundle version.`);
    }
    const metric = requireMetric(candidate.metricId, registry, label);
    if (metric.valueType === "BOOLEAN") {
      if (candidate.threshold !== true) {
        invalid(`${label}.threshold must be true for boolean metrics.`);
      }
    } else if (
      !Number.isSafeInteger(candidate.threshold)
      || (candidate.threshold as number) < 1
    ) {
      invalid(`${label}.threshold must be a positive safe integer.`);
    }
    if (candidate.tier !== undefined && !TIERS.has(String(candidate.tier))) {
      invalid(`${label}.tier is unsupported.`);
    }
    requireLocalizationKey(candidate.titleKey, `${label}.titleKey`);
    requireLocalizationKey(candidate.descriptionKey, `${label}.descriptionKey`);
    if (!VISIBILITIES.has(String(candidate.visibility))) {
      invalid(`${label}.visibility is unsupported.`);
    }
    if (
      candidate.visibility === "PROFILE_SAFE"
      && metric.privacyClass !== "PROFILE_PUBLIC"
    ) {
      invalid(`${label} must use PROFILE_PUBLIC data for PROFILE_SAFE visibility.`);
    }
    if (!isSafeNonnegativeInteger(candidate.sortOrder)) {
      invalid(`${label}.sortOrder must be a nonnegative safe integer.`);
    }
    if (sortOrders.has(candidate.sortOrder)) {
      invalid(`${label}.sortOrder must be unique within the rule set.`);
    }
    sortOrders.add(candidate.sortOrder);
  }
}

function validateLevelDefinitions(value: unknown): void {
  if (!Array.isArray(value)) invalid("levelDefinitions must be an array.");
  let previousLevel = 0;
  let previousThreshold = -1;
  for (const [index, candidate] of value.entries()) {
    const label = `levelDefinitions[${index}]`;
    if (!isRecord(candidate)) invalid(`${label} must be an object.`);
    assertExactKeys(candidate, LEVEL_KEYS, label);
    if (
      !Number.isSafeInteger(candidate.level)
      || (candidate.level as number) < 1
      || (candidate.level as number) <= previousLevel
    ) {
      invalid(`${label}.level must be a strictly increasing positive integer.`);
    }
    if (
      !isSafeNonnegativeInteger(candidate.minimumLifetimePoints)
      || candidate.minimumLifetimePoints <= previousThreshold
    ) {
      invalid(`${label}.minimumLifetimePoints must strictly increase.`);
    }
    if (index === 0 && (candidate.level !== 1 || candidate.minimumLifetimePoints !== 0)) {
      invalid("The first level must be level 1 with a zero-point threshold.");
    }
    if (candidate.titleKey !== undefined) {
      requireLocalizationKey(candidate.titleKey, `${label}.titleKey`);
    }
    previousLevel = candidate.level as number;
    previousThreshold = candidate.minimumLifetimePoints;
  }
}

function validateChallengeContracts(
  value: unknown,
  bundleVersion: string,
  registry: Map<string, GamificationMetricDefinition>,
  ids: Set<string>,
): void {
  if (!Array.isArray(value)) {
    invalid("challengeDefinitionContracts must be an array.");
  }
  const sortOrders = new Set<number>();
  for (const [index, candidate] of value.entries()) {
    const label = `challengeDefinitionContracts[${index}]`;
    if (!isRecord(candidate)) invalid(`${label} must be an object.`);
    assertExactKeys(candidate, CHALLENGE_KEYS, label);
    requireNamespacedId(candidate.id, `${label}.id`);
    if (ids.has(candidate.id)) invalid(`Duplicate definition ID ${candidate.id}.`);
    ids.add(candidate.id);
    if (candidate.ruleSetVersion !== bundleVersion) {
      invalid(`${label}.ruleSetVersion must match the bundle version.`);
    }
    if (
      typeof candidate.metricId !== "string"
      || !CHALLENGE_WINDOW_METRIC_IDS.has(candidate.metricId)
    ) {
      invalid(`${label}.metricId is not supported by the Challenge window adapter.`);
    }
    const metric = registry.get(candidate.metricId);
    if (!metric || metric.privacyClass !== "PRIVATE_STUDY") {
      invalid(`${label}.metricId must be a registered private-study metric.`);
    }
    if (metric.valueType !== "INTEGER") {
      invalid(`${label} must use an integer metric.`);
    }
    if (
      !Number.isSafeInteger(candidate.target)
      || (candidate.target as number) < 1
    ) {
      invalid(`${label}.target must be a positive safe integer.`);
    }
    if (!CHALLENGE_ENROLLMENT_POLICIES.has(String(candidate.enrollmentPolicy))) {
      invalid(`${label}.enrollmentPolicy is unsupported.`);
    }
    if (!CHALLENGE_WINDOW_POLICIES.has(String(candidate.windowPolicy))) {
      invalid(`${label}.windowPolicy is unsupported.`);
    }
    requireLocalizationKey(candidate.titleKey, `${label}.titleKey`);
    requireLocalizationKey(candidate.descriptionKey, `${label}.descriptionKey`);
    if (!CHALLENGE_VISIBILITIES.has(String(candidate.visibility))) {
      invalid(`${label}.visibility is unsupported.`);
    }
    if (!isSafeNonnegativeInteger(candidate.sortOrder)) {
      invalid(`${label}.sortOrder must be a nonnegative safe integer.`);
    }
    if (sortOrders.has(candidate.sortOrder as number)) {
      invalid(`${label}.sortOrder must be unique within the Challenge definitions.`);
    }
    sortOrders.add(candidate.sortOrder as number);
  }
}

function validateLeaderboardContracts(
  value: unknown,
  bundleVersion: string,
  registry: Map<string, GamificationMetricDefinition>,
  ids: Set<string>,
): void {
  if (!Array.isArray(value)) {
    invalid("leaderboardDefinitionContracts must be an array.");
  }
  for (const [index, candidate] of value.entries()) {
    const label = `leaderboardDefinitionContracts[${index}]`;
    if (!isRecord(candidate)) invalid(`${label} must be an object.`);
    assertExactKeys(candidate, LEADERBOARD_KEYS, label);
    requireNamespacedId(candidate.id, `${label}.id`);
    if (ids.has(candidate.id)) invalid(`Duplicate definition ID ${candidate.id}.`);
    ids.add(candidate.id);
    if (candidate.ruleSetVersion !== bundleVersion) {
      invalid(`${label}.ruleSetVersion must match the bundle version.`);
    }
    if (!LEADERBOARD_PERIODS.has(String(candidate.period))) {
      invalid(`${label}.period is unsupported.`);
    }
    requireMetric(
      candidate.scoreMetricId,
      registry,
      label,
      true,
    );
    if (candidate.scoreMetricId !== GAMIFICATION_METRIC_IDS.pointsTotal) {
      invalid(`${label} must use the canonical points.total score metric.`);
    }
  }
}

export function validateGamificationDefinitionBundle(
  input: unknown,
  registry: readonly GamificationMetricDefinition[] =
    getGamificationMetricDefinitions(),
): asserts input is GamificationDefinitionBundle {
  if (!isRecord(input)) invalid("Definition bundle must be an object.");
  assertExactKeys(input, TOP_LEVEL_KEYS, "definition bundle");
  requireNonemptyString(input.version, "version", 64);
  if (!GAMIFICATION_RULE_VERSION_PATTERN.test(input.version)) {
    invalid("version must use the gamification-vN naming format.");
  }
  if (input.schemaVersion !== GAMIFICATION_DEFINITION_SCHEMA_VERSION) {
    invalid("Definition bundle uses an unsupported schema version.");
  }
  if (!Array.isArray(input.pointCategories)) {
    invalid("pointCategories must be an array.");
  }
  if (
    input.pointCategories.length !== GAMIFICATION_POINT_CATEGORIES.length
    || input.pointCategories.some(
      (category, index) => category !== GAMIFICATION_POINT_CATEGORIES[index],
    )
  ) {
    invalid("pointCategories must exactly match the canonical Study Points categories.");
  }

  const metricRegistry = metricRegistryMap(registry);
  const definitionIds = new Set<string>();
  validateAchievementDefinitions(
    input.achievementDefinitions,
    input.version,
    metricRegistry,
    definitionIds,
  );
  validateLevelDefinitions(input.levelDefinitions);
  validateChallengeContracts(
    input.challengeDefinitionContracts,
    input.version,
    metricRegistry,
    definitionIds,
  );
  validateLeaderboardContracts(
    input.leaderboardDefinitionContracts,
    input.version,
    metricRegistry,
    definitionIds,
  );
}