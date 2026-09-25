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
  levelDefinitions: [],
  challengeDefinitionContracts: [],
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