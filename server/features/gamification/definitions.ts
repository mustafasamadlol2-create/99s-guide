import { STUDY_POINTS_CATEGORIES } from "../study-points/constants.js";
import { GAMIFICATION_DEFINITION_SCHEMA_VERSION } from "./constants.js";
import { GamificationError } from "./errors.js";
import type { GamificationDefinitionBundle } from "./types.js";
import { validateGamificationDefinitionBundle } from "./validation.js";

export const GAMIFICATION_V1_RULE_SET_VERSION = "gamification-v1";
export const GAMIFICATION_V2_RULE_SET_VERSION = "gamification-v2";
// Bump this pointer only when a new source-controlled bundle is intended to
// become the active production ruleset. Historical bundles remain readable.
export const GAMIFICATION_CURRENT_RULE_SET_VERSION =
  GAMIFICATION_V2_RULE_SET_VERSION;

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


const gamificationV2 = deepFreeze<GamificationDefinitionBundle>({
  version: GAMIFICATION_V2_RULE_SET_VERSION,
  schemaVersion: GAMIFICATION_DEFINITION_SCHEMA_VERSION,
  pointCategories: [...STUDY_POINTS_CATEGORIES],
  achievementDefinitions: [
    {
      id: "achievement.lectures.first_completion",
      ruleSetVersion: GAMIFICATION_V2_RULE_SET_VERSION,
      metricId: "learning.lecture_completions",
      threshold: 1,
      rewardPoints: 15,
      titleKey: "gamification.achievement.first_lecture.title",
      descriptionKey: "gamification.achievement.first_lecture.description",
      visibility: "PRIVATE",
      sortOrder: 10,
    },
    {
      id: "achievement.lectures.ten_completed",
      ruleSetVersion: GAMIFICATION_V2_RULE_SET_VERSION,
      metricId: "learning.lecture_completions",
      threshold: 10,
      rewardPoints: 50,
      titleKey: "gamification.achievement.ten_lectures.title",
      descriptionKey: "gamification.achievement.ten_lectures.description",
      visibility: "PRIVATE",
      sortOrder: 20,
    },
    {
      id: "achievement.mcq.fifty_correct",
      ruleSetVersion: GAMIFICATION_V2_RULE_SET_VERSION,
      metricId: "learning.mcq_first_correct",
      threshold: 50,
      rewardPoints: 50,
      titleKey: "gamification.achievement.fifty_mcq.title",
      descriptionKey: "gamification.achievement.fifty_mcq.description",
      visibility: "PRIVATE",
      sortOrder: 30,
    },
    {
      id: "achievement.mcq.two_hundred_correct",
      ruleSetVersion: GAMIFICATION_V2_RULE_SET_VERSION,
      metricId: "learning.mcq_first_correct",
      threshold: 200,
      rewardPoints: 120,
      titleKey: "gamification.achievement.two_hundred_mcq.title",
      descriptionKey: "gamification.achievement.two_hundred_mcq.description",
      visibility: "PRIVATE",
      sortOrder: 40,
    },
    {
      id: "achievement.flashcards.twenty_five_recalls",
      ruleSetVersion: GAMIFICATION_V2_RULE_SET_VERSION,
      metricId: "learning.flashcard_first_recalls",
      threshold: 25,
      rewardPoints: 30,
      titleKey: "gamification.achievement.flashcard_25.title",
      descriptionKey: "gamification.achievement.flashcard_25.description",
      visibility: "PRIVATE",
      sortOrder: 50,
    },
    {
      id: "achievement.focus.ten_sessions",
      ruleSetVersion: GAMIFICATION_V2_RULE_SET_VERSION,
      metricId: "focus.completed_sessions",
      threshold: 10,
      rewardPoints: 50,
      titleKey: "gamification.achievement.focus_10.title",
      descriptionKey: "gamification.achievement.focus_10.description",
      visibility: "PRIVATE",
      sortOrder: 60,
    },
    {
      id: "achievement.consistency.seven_days",
      ruleSetVersion: GAMIFICATION_V2_RULE_SET_VERSION,
      metricId: "consistency.qualifying_days",
      threshold: 7,
      rewardPoints: 60,
      titleKey: "gamification.achievement.consistency_7.title",
      descriptionKey: "gamification.achievement.consistency_7.description",
      visibility: "PRIVATE",
      sortOrder: 70,
    },
  ],
  levelDefinitions: [
    { level: 1, minimumLifetimePoints: 0, titleKey: "gamification.level.explorer" },
    { level: 2, minimumLifetimePoints: 100, titleKey: "gamification.level.learner" },
    { level: 3, minimumLifetimePoints: 250, titleKey: "gamification.level.scholar" },
    { level: 4, minimumLifetimePoints: 500, titleKey: "gamification.level.achiever" },
    { level: 5, minimumLifetimePoints: 900, titleKey: "gamification.level.pathfinder" },
    { level: 6, minimumLifetimePoints: 1400, titleKey: "gamification.level.strategist" },
    { level: 7, minimumLifetimePoints: 2100, titleKey: "gamification.level.specialist" },
    { level: 8, minimumLifetimePoints: 3000, titleKey: "gamification.level.mentor" },
    { level: 9, minimumLifetimePoints: 4200, titleKey: "gamification.level.vanguard" },
    { level: 10, minimumLifetimePoints: 5600, titleKey: "gamification.level.luminary" },
  ],
  challengeDefinitionContracts: [
    {
      id: "challenge.v2.consistency.weekly_4_days",
      ruleSetVersion: GAMIFICATION_V2_RULE_SET_VERSION,
      metricId: "consistency.qualifying_days",
      target: 4,
      rewardPoints: 30,
      enrollmentPolicy: "AUTO",
      windowPolicy: "WEEKLY",
      titleKey: "gamification.challenge.consistency_4.title",
      descriptionKey: "gamification.challenge.consistency_4.description",
      visibility: "PRIVATE_STUDY",
      sortOrder: 10,
    },
    {
      id: "challenge.v2.focus.weekly_90_minutes",
      ruleSetVersion: GAMIFICATION_V2_RULE_SET_VERSION,
      metricId: "focus.verified_seconds",
      target: 5400,
      rewardPoints: 35,
      enrollmentPolicy: "AUTO",
      windowPolicy: "WEEKLY",
      titleKey: "gamification.challenge.focus_90.title",
      descriptionKey: "gamification.challenge.focus_90.description",
      visibility: "PRIVATE_STUDY",
      sortOrder: 20,
    },
    {
      id: "challenge.v2.lectures.weekly_3_completed",
      ruleSetVersion: GAMIFICATION_V2_RULE_SET_VERSION,
      metricId: "learning.lecture_completions",
      target: 3,
      rewardPoints: 40,
      enrollmentPolicy: "AUTO",
      windowPolicy: "WEEKLY",
      titleKey: "gamification.challenge.lectures_3.title",
      descriptionKey: "gamification.challenge.lectures_3.description",
      visibility: "PRIVATE_STUDY",
      sortOrder: 30,
    },
    {
      id: "challenge.v2.mcq.weekly_25_correct",
      ruleSetVersion: GAMIFICATION_V2_RULE_SET_VERSION,
      metricId: "learning.mcq_first_correct",
      target: 25,
      rewardPoints: 45,
      enrollmentPolicy: "AUTO",
      windowPolicy: "WEEKLY",
      titleKey: "gamification.challenge.mcq_25.title",
      descriptionKey: "gamification.challenge.mcq_25.description",
      visibility: "PRIVATE_STUDY",
      sortOrder: 40,
    },
  ],
  leaderboardDefinitionContracts: [],
});

const sourceBundles = new Map<string, GamificationDefinitionBundle>([
  [gamificationV1.version, gamificationV1],
  [gamificationV2.version, gamificationV2],
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

export function getCurrentGamificationDefinitionBundle():
GamificationDefinitionBundle {
  return getGamificationDefinitionBundle(GAMIFICATION_CURRENT_RULE_SET_VERSION);
}

export function getGamificationDefinitionVersions(): readonly string[] {
  return [...sourceBundles.keys()].sort();
}

export { validateGamificationDefinitionBundle };