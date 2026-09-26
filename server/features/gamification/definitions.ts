import { STUDY_POINTS_CATEGORIES } from "../study-points/constants.js";
import { GAMIFICATION_DEFINITION_SCHEMA_VERSION } from "./constants.js";
import { GamificationError } from "./errors.js";
import type { GamificationDefinitionBundle } from "./types.js";
import { validateGamificationDefinitionBundle } from "./validation.js";

export const GAMIFICATION_V1_RULE_SET_VERSION = "gamification-v1";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

const gamificationV1 = deepFreeze<GamificationDefinitionBundle>({
  version: GAMIFICATION_V1_RULE_SET_VERSION,
  schemaVersion: GAMIFICATION_DEFINITION_SCHEMA_VERSION,
  pointCategories: [...STUDY_POINTS_CATEGORIES],
  achievementDefinitions: [
    {
      id: "achievement.focus.first_verified_session",
      ruleSetVersion: GAMIFICATION_V1_RULE_SET_VERSION,
      metricId: "focus.completed_sessions",
      threshold: 1,
      titleKey: "gamification.achievement.first_focus.title",
      descriptionKey: "gamification.achievement.first_focus.description",
      visibility: "PRIVATE",
      sortOrder: 10,
    },
    {
      id: "achievement.points.first_100",
      ruleSetVersion: GAMIFICATION_V1_RULE_SET_VERSION,
      metricId: "points.total",
      threshold: 100,
      titleKey: "gamification.achievement.first_100_points.title",
      descriptionKey: "gamification.achievement.first_100_points.description",
      visibility: "PRIVATE",
      sortOrder: 20,
    },
    {
      id: "achievement.group_focus.first_verified_run",
      ruleSetVersion: GAMIFICATION_V1_RULE_SET_VERSION,
      metricId: "group_focus.completed_runs",
      threshold: 1,
      titleKey: "gamification.achievement.first_group_focus.title",
      descriptionKey: "gamification.achievement.first_group_focus.description",
      visibility: "PRIVATE",
      sortOrder: 30,
    },
  ],
  levelDefinitions: [
    { level: 1, minimumLifetimePoints: 0 },
    { level: 2, minimumLifetimePoints: 100 },
    { level: 3, minimumLifetimePoints: 250 },
    { level: 4, minimumLifetimePoints: 500 },
    { level: 5, minimumLifetimePoints: 900 },
    { level: 6, minimumLifetimePoints: 1400 },
    { level: 7, minimumLifetimePoints: 2100 },
    { level: 8, minimumLifetimePoints: 3000 },
    { level: 9, minimumLifetimePoints: 4200 },
    { level: 10, minimumLifetimePoints: 5600 },
  ],
  challengeDefinitionContracts: [
    {
      id: "challenge.focus.weekly_3_sessions",
      ruleSetVersion: GAMIFICATION_V1_RULE_SET_VERSION,
      metricId: "focus.completed_sessions",
      target: 3,
      enrollmentPolicy: "AUTO",
      windowPolicy: "WEEKLY",
      titleKey: "gamification.challenge.weekly_focus_sessions.title",
      descriptionKey: "gamification.challenge.weekly_focus_sessions.description",
      visibility: "PRIVATE_STUDY",
      sortOrder: 10,
    },
    {
      id: "challenge.focus.weekly_120_minutes",
      ruleSetVersion: GAMIFICATION_V1_RULE_SET_VERSION,
      metricId: "focus.verified_seconds",
      target: 7200,
      enrollmentPolicy: "AUTO",
      windowPolicy: "WEEKLY",
      titleKey: "gamification.challenge.weekly_focus_minutes.title",
      descriptionKey: "gamification.challenge.weekly_focus_minutes.description",
      visibility: "PRIVATE_STUDY",
      sortOrder: 20,
    },
    {
      id: "challenge.consistency.weekly_3_days",
      ruleSetVersion: GAMIFICATION_V1_RULE_SET_VERSION,
      metricId: "consistency.qualifying_days",
      target: 3,
      enrollmentPolicy: "AUTO",
      windowPolicy: "WEEKLY",
      titleKey: "gamification.challenge.weekly_consistency_days.title",
      descriptionKey: "gamification.challenge.weekly_consistency_days.description",
      visibility: "PRIVATE_STUDY",
      sortOrder: 30,
    },
    {
      id: "challenge.group_focus.weekly_2_runs",
      ruleSetVersion: GAMIFICATION_V1_RULE_SET_VERSION,
      metricId: "group_focus.completed_runs",
      target: 2,
      enrollmentPolicy: "AUTO",
      windowPolicy: "WEEKLY",
      titleKey: "gamification.challenge.weekly_group_focus_runs.title",
      descriptionKey: "gamification.challenge.weekly_group_focus_runs.description",
      visibility: "PRIVATE_STUDY",
      sortOrder: 40,
    },
  ],
  leaderboardDefinitionContracts: [],
});

const sourceBundles = new Map<string, GamificationDefinitionBundle>([
  [gamificationV1.version, gamificationV1],
]);

export function getGamificationDefinitionBundle(
  version: string,
): GamificationDefinitionBundle {
  const bundle = sourceBundles.get(version);
  if (!bundle) {
    throw new GamificationError(
      "GAMIFICATION_DEFINITION_BUNDLE_NOT_FOUND",
      `No source-controlled gamification definition bundle exists for ${version}.`,
    );
  }
  validateGamificationDefinitionBundle(bundle);
  return bundle;
}

export function getGamificationDefinitionVersions(): readonly string[] {
  return [...sourceBundles.keys()].sort();
}

export { validateGamificationDefinitionBundle };