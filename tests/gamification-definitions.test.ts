import assert from "node:assert/strict";
import test from "node:test";
import {
  GAMIFICATION_METRIC_IDS,
  GAMIFICATION_V1_RULE_SET_VERSION,
  GAMIFICATION_V2_RULE_SET_VERSION,
  GAMIFICATION_V3_RULE_SET_VERSION,
  GamificationError,
  checksumGamificationChallengeDefinitions,
  checksumGamificationDefinitionBundle,
  checksumGamificationLevelDefinitions,
  getGamificationDefinitionBundle,
  getGamificationDefinitionVersions,
  getGamificationMetricDefinitions,
  isGamificationThresholdMet,
  selectWeeklyChallengeDefinitions,
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

test("historical bundles remain immutable while v3 is the production definition bundle", () => {
  const bundle = getGamificationDefinitionBundle(GAMIFICATION_V1_RULE_SET_VERSION);
  assert.equal(bundle.version, "gamification-v1");
  assert.deepEqual(getGamificationDefinitionVersions(), ["gamification-v1", "gamification-v2", "gamification-v3"]);
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

  const consistency = getGamificationMetricDefinitions().find(
    (metric) => metric.id === GAMIFICATION_METRIC_IDS.consistencyQualifyingDays,
  );
  assert.equal(consistency?.available, true);

  const v2 = getGamificationDefinitionBundle(GAMIFICATION_V2_RULE_SET_VERSION);
  assert.equal(v2.levelDefinitions.length, 10);
  assert.equal(v2.achievementDefinitions.length, 7);
  assert.equal(v2.challengeDefinitionContracts.length, 4);
  assert.deepEqual(
    v2.levelDefinitions.map(({ minimumLifetimePoints }) => minimumLifetimePoints),
    [0, 100, 250, 500, 900, 1400, 2100, 3000, 4200, 5600],
  );
  assert.ok(v2.levelDefinitions.every(({ titleKey }) => Boolean(titleKey)));
  assert.ok(v2.achievementDefinitions.every(({ rewardPoints }) => Number(rewardPoints) > 0));
  assert.ok(v2.challengeDefinitionContracts.every(({ rewardPoints }) => Number(rewardPoints) > 0));
  validateGamificationDefinitionBundle(v2);

  const v3 = getGamificationDefinitionBundle(GAMIFICATION_V3_RULE_SET_VERSION);
  assert.equal(v3.levelDefinitions.length, 10);
  assert.equal(v3.achievementDefinitions.length, 20);
  assert.equal(v3.challengeDefinitionContracts.length, 10);
  assert.ok(v3.achievementDefinitions.every(({ rewardPoints }) => Number(rewardPoints) > 0));
  assert.ok(v3.challengeDefinitionContracts.every(({ rewardPoints }) => Number(rewardPoints) > 0));
  assert.equal(v3.achievementDefinitions.filter(({ hiddenUntilUnlocked }) => hiddenUntilUnlocked).length, 5);
  const selectedWeekA = selectWeeklyChallengeDefinitions(v3, "2026-10-25");
  const selectedWeekB = selectWeeklyChallengeDefinitions(v3, "2026-11-01");
  assert.equal(selectedWeekA.length, 4);
  assert.equal(new Set(selectedWeekA.map(({ metricId }) => metricId)).size, 4);
  assert.equal(selectedWeekB.length, 4);
  assert.notDeepEqual(selectedWeekA.map(({ id }) => id), selectedWeekB.map(({ id }) => id));
  validateGamificationDefinitionBundle(v3);

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
  const changedChallenge = cloneBundle();
  changedChallenge.challengeDefinitionContracts[0]!.target += 1;
  assert.equal(checksumGamificationDefinitionBundle(changedChallenge), checksum);
  assert.notEqual(
    checksumGamificationChallengeDefinitions(changedChallenge),
    checksumGamificationChallengeDefinitions(bundle),
  );
});

test("definition validation accepts canonical rewards and rejects malformed reward fields", () => {
  const withRewardField = cloneBundle() as unknown as Record<string, unknown>;
  const achievements = withRewardField.achievementDefinitions as Record<string, unknown>[];
  achievements[0]!.pointsReward = 100;
  assertDefinitionInvalid(() =>
    validateGamificationDefinitionBundle(withRewardField),
  );

  const malformedReward = cloneBundle();
  malformedReward.achievementDefinitions[0]!.rewardPoints = 0;
  assertDefinitionInvalid(() =>
    validateGamificationDefinitionBundle(malformedReward),
  );

  const validReward = cloneBundle();
  validReward.achievementDefinitions[0]!.rewardPoints = 25;
  validateGamificationDefinitionBundle(validReward);
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