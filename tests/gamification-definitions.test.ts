import assert from "node:assert/strict";
import test from "node:test";
import {
  GAMIFICATION_METRIC_IDS,
  GAMIFICATION_V1_RULE_SET_VERSION,
  GamificationError,
  checksumGamificationDefinitionBundle,
  checksumGamificationLevelDefinitions,
  getGamificationDefinitionBundle,
  getGamificationDefinitionVersions,
  getGamificationMetricDefinitions,
  isGamificationThresholdMet,
  validateGamificationDefinitionBundle,
} from "../server/features/gamification/index.js";
import type {
  GamificationDefinitionBundle,
  GamificationMetricDefinition,
} from "../server/features/gamification/types.js";

function cloneBundle(): GamificationDefinitionBundle {
  return structuredClone(
    getGamificationDefinitionBundle(GAMIFICATION_V1_RULE_SET_VERSION),
  ) as GamificationDefinitionBundle;
}

function assertDefinitionInvalid(callback: () => unknown): void {
  assert.throws(callback, (error: unknown) =>
    error instanceof GamificationError
    && error.code === "GAMIFICATION_DEFINITION_INVALID");
}

test("v1 bundle is immutable, deterministic, and excludes unavailable lifetime consistency", () => {
  const bundle = getGamificationDefinitionBundle(GAMIFICATION_V1_RULE_SET_VERSION);
  assert.equal(bundle.version, "gamification-v1");
  assert.deepEqual(getGamificationDefinitionVersions(), ["gamification-v1"]);
  assert.equal(Object.isFrozen(bundle), true);
  assert.equal(Object.isFrozen(bundle.achievementDefinitions), true);
  assert.equal(bundle.achievementDefinitions.length, 3);
  assert.equal(
    bundle.achievementDefinitions.some(
      (achievement) =>
        achievement.metricId === GAMIFICATION_METRIC_IDS.consistencyQualifyingDays,
    ),
    false,
  );
  validateGamificationDefinitionBundle(bundle);

  const unavailable = getGamificationMetricDefinitions().find(
    (metric) => metric.id === GAMIFICATION_METRIC_IDS.consistencyQualifyingDays,
  );
  assert.equal(unavailable?.available, false);
  assert.ok(unavailable?.unavailableReason);

  const checksum = checksumGamificationDefinitionBundle(bundle);
  const reordered = Object.fromEntries(
    Object.entries(bundle).reverse(),
  ) as unknown as GamificationDefinitionBundle;
  assert.equal(checksumGamificationDefinitionBundle(reordered), checksum);
  const changed = cloneBundle();
  changed.achievementDefinitions[0]!.threshold = 2;
  assert.notEqual(checksumGamificationDefinitionBundle(changed), checksum);
  const changedLevel = cloneBundle();
  changedLevel.levelDefinitions[3]!.minimumLifetimePoints += 10;
  assert.equal(checksumGamificationDefinitionBundle(changedLevel), checksum);
  assert.notEqual(
    checksumGamificationLevelDefinitions(changedLevel),
    checksumGamificationLevelDefinitions(bundle),
  );
});

test("definition validation rejects unknown reward fields and unavailable metrics", () => {
  const withRewardField = cloneBundle() as unknown as Record<string, unknown>;
  const achievements = withRewardField.achievementDefinitions as Record<string, unknown>[];
  achievements[0]!.pointsReward = 100;
  assertDefinitionInvalid(() =>
    validateGamificationDefinitionBundle(withRewardField),
  );

  const withUnavailableMetric = cloneBundle();
  (
    withUnavailableMetric.achievementDefinitions as unknown as Array<
      GamificationDefinitionBundle["achievementDefinitions"][number]
    >
  ).push({
    id: "achievement.consistency.unverified",
    ruleSetVersion: withUnavailableMetric.version,
    metricId: GAMIFICATION_METRIC_IDS.consistencyQualifyingDays,
    threshold: 1,
    titleKey: "gamification.achievement.consistency.title",
    descriptionKey: "gamification.achievement.consistency.description",
    visibility: "PRIVATE",
    sortOrder: 40,
  });
  assertDefinitionInvalid(() =>
    validateGamificationDefinitionBundle(withUnavailableMetric),
  );
});

test("definition validation enforces namespaced unique IDs, point categories, and privacy", () => {
  const duplicate = cloneBundle();
  duplicate.achievementDefinitions[1]!.id =
    duplicate.achievementDefinitions[0]!.id;
  assertDefinitionInvalid(() => validateGamificationDefinitionBundle(duplicate));

  const badCategories = cloneBundle();
  (badCategories.pointCategories as string[])[0] = "CUSTOM";
  assertDefinitionInvalid(() =>
    validateGamificationDefinitionBundle(badCategories),
  );

  const restrictedRegistry = getGamificationMetricDefinitions().map(
    (metric): GamificationMetricDefinition =>
      metric.id === GAMIFICATION_METRIC_IDS.focusCompletedSessions
        ? { ...metric, privacyClass: "ADMIN_SECURITY" }
        : metric,
  );
  assertDefinitionInvalid(() =>
    validateGamificationDefinitionBundle(cloneBundle(), restrictedRegistry),
  );

  const unsafeVisibility = cloneBundle();
  unsafeVisibility.achievementDefinitions[0]!.visibility = "PROFILE_SAFE";
  assertDefinitionInvalid(() =>
    validateGamificationDefinitionBundle(unsafeVisibility),
  );
});

test("threshold evaluation is deterministic and monotonic", () => {
  assert.equal(isGamificationThresholdMet(100, 100), true);
  assert.equal(isGamificationThresholdMet(99, 100), false);
  assert.equal(isGamificationThresholdMet(true, true), true);
  assert.equal(isGamificationThresholdMet(false, true), false);
  for (let threshold = 1; threshold < 100; threshold += 1) {
    assert.equal(
      isGamificationThresholdMet(threshold + 1, threshold),
      true,
    );
    assert.equal(
      isGamificationThresholdMet(threshold - 1, threshold),
      false,
    );
  }
  assert.throws(
    () => isGamificationThresholdMet(-1, 1),
    (error: unknown) =>
      error instanceof GamificationError
      && error.code === "GAMIFICATION_INVALID_INPUT",
  );
});