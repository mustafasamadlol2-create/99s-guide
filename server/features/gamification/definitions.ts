import { STUDY_POINTS_CATEGORIES } from "../study-points/constants.js";
import { GAMIFICATION_DEFINITION_SCHEMA_VERSION } from "./constants.js";
import { GamificationError } from "./errors.js";
import type { GamificationDefinitionBundle } from "./types.js";
import { validateGamificationDefinitionBundle } from "./validation.js";

export const GAMIFICATION_V1_RULE_SET_VERSION = "gamification-v1";
export const GAMIFICATION_V2_RULE_SET_VERSION = "gamification-v2";
export const GAMIFICATION_V3_RULE_SET_VERSION = "gamification-v3";
// Bump this pointer only when a new source-controlled bundle is intended to
// become the active production ruleset. Historical bundles remain readable.
export const GAMIFICATION_CURRENT_RULE_SET_VERSION =
  GAMIFICATION_V3_RULE_SET_VERSION;

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


const gamificationV3 = deepFreeze<GamificationDefinitionBundle>({
  version: GAMIFICATION_V3_RULE_SET_VERSION,
  schemaVersion: GAMIFICATION_DEFINITION_SCHEMA_VERSION,
  pointCategories: [...STUDY_POINTS_CATEGORIES],
  achievementDefinitions: [
    { id: "achievement.lectures.first_completion", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "learning.lecture_completions", threshold: 1, rewardPoints: 15, tier: "BRONZE", titleKey: "gamification.achievement.first_lecture.title", descriptionKey: "gamification.achievement.first_lecture.description", visibility: "PRIVATE", sortOrder: 10 },
    { id: "achievement.lectures.ten_completed", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "learning.lecture_completions", threshold: 10, rewardPoints: 50, tier: "BRONZE", titleKey: "gamification.achievement.ten_lectures.title", descriptionKey: "gamification.achievement.ten_lectures.description", visibility: "PRIVATE", sortOrder: 20 },
    { id: "achievement.lectures.twenty_five_completed", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "learning.lecture_completions", threshold: 25, rewardPoints: 100, tier: "SILVER", titleKey: "gamification.achievement.twenty_five_lectures.title", descriptionKey: "gamification.achievement.twenty_five_lectures.description", visibility: "PRIVATE", sortOrder: 30 },
    { id: "achievement.lectures.fifty_completed", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "learning.lecture_completions", threshold: 50, rewardPoints: 180, tier: "GOLD", hiddenUntilUnlocked: true, titleKey: "gamification.achievement.fifty_lectures.title", descriptionKey: "gamification.achievement.fifty_lectures.description", visibility: "PRIVATE", sortOrder: 40 },

    { id: "achievement.mcq.ten_correct", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "learning.mcq_first_correct", threshold: 10, rewardPoints: 15, tier: "BRONZE", titleKey: "gamification.achievement.ten_mcq.title", descriptionKey: "gamification.achievement.ten_mcq.description", visibility: "PRIVATE", sortOrder: 50 },
    { id: "achievement.mcq.fifty_correct", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "learning.mcq_first_correct", threshold: 50, rewardPoints: 50, tier: "BRONZE", titleKey: "gamification.achievement.fifty_mcq.title", descriptionKey: "gamification.achievement.fifty_mcq.description", visibility: "PRIVATE", sortOrder: 60 },
    { id: "achievement.mcq.one_hundred_correct", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "learning.mcq_first_correct", threshold: 100, rewardPoints: 80, tier: "SILVER", titleKey: "gamification.achievement.one_hundred_mcq.title", descriptionKey: "gamification.achievement.one_hundred_mcq.description", visibility: "PRIVATE", sortOrder: 70 },
    { id: "achievement.mcq.two_hundred_fifty_correct", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "learning.mcq_first_correct", threshold: 250, rewardPoints: 150, tier: "SILVER", titleKey: "gamification.achievement.two_hundred_fifty_mcq.title", descriptionKey: "gamification.achievement.two_hundred_fifty_mcq.description", visibility: "PRIVATE", sortOrder: 80 },
    { id: "achievement.mcq.five_hundred_correct", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "learning.mcq_first_correct", threshold: 500, rewardPoints: 250, tier: "GOLD", hiddenUntilUnlocked: true, titleKey: "gamification.achievement.five_hundred_mcq.title", descriptionKey: "gamification.achievement.five_hundred_mcq.description", visibility: "PRIVATE", sortOrder: 90 },

    { id: "achievement.flashcards.twenty_five_recalls", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "learning.flashcard_first_recalls", threshold: 25, rewardPoints: 30, tier: "BRONZE", titleKey: "gamification.achievement.flashcard_25.title", descriptionKey: "gamification.achievement.flashcard_25.description", visibility: "PRIVATE", sortOrder: 100 },
    { id: "achievement.flashcards.one_hundred_recalls", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "learning.flashcard_first_recalls", threshold: 100, rewardPoints: 75, tier: "SILVER", titleKey: "gamification.achievement.flashcard_100.title", descriptionKey: "gamification.achievement.flashcard_100.description", visibility: "PRIVATE", sortOrder: 110 },
    { id: "achievement.flashcards.two_hundred_fifty_recalls", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "learning.flashcard_first_recalls", threshold: 250, rewardPoints: 150, tier: "GOLD", hiddenUntilUnlocked: true, titleKey: "gamification.achievement.flashcard_250.title", descriptionKey: "gamification.achievement.flashcard_250.description", visibility: "PRIVATE", sortOrder: 120 },

    { id: "achievement.focus.first_verified_session", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "focus.completed_sessions", threshold: 1, rewardPoints: 15, tier: "BRONZE", titleKey: "gamification.achievement.first_focus.title", descriptionKey: "gamification.achievement.first_focus.description", visibility: "PRIVATE", sortOrder: 130 },
    { id: "achievement.focus.ten_sessions", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "focus.completed_sessions", threshold: 10, rewardPoints: 50, tier: "BRONZE", titleKey: "gamification.achievement.focus_10.title", descriptionKey: "gamification.achievement.focus_10.description", visibility: "PRIVATE", sortOrder: 140 },
    { id: "achievement.focus.twenty_five_sessions", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "focus.completed_sessions", threshold: 25, rewardPoints: 100, tier: "SILVER", titleKey: "gamification.achievement.focus_25.title", descriptionKey: "gamification.achievement.focus_25.description", visibility: "PRIVATE", sortOrder: 150 },
    { id: "achievement.focus.fifty_sessions", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "focus.completed_sessions", threshold: 50, rewardPoints: 180, tier: "GOLD", hiddenUntilUnlocked: true, titleKey: "gamification.achievement.focus_50.title", descriptionKey: "gamification.achievement.focus_50.description", visibility: "PRIVATE", sortOrder: 160 },

    { id: "achievement.consistency.three_days", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "consistency.qualifying_days", threshold: 3, rewardPoints: 20, tier: "BRONZE", titleKey: "gamification.achievement.consistency_3.title", descriptionKey: "gamification.achievement.consistency_3.description", visibility: "PRIVATE", sortOrder: 170 },
    { id: "achievement.consistency.seven_days", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "consistency.qualifying_days", threshold: 7, rewardPoints: 60, tier: "BRONZE", titleKey: "gamification.achievement.consistency_7.title", descriptionKey: "gamification.achievement.consistency_7.description", visibility: "PRIVATE", sortOrder: 180 },
    { id: "achievement.consistency.fourteen_days", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "consistency.qualifying_days", threshold: 14, rewardPoints: 120, tier: "SILVER", titleKey: "gamification.achievement.consistency_14.title", descriptionKey: "gamification.achievement.consistency_14.description", visibility: "PRIVATE", sortOrder: 190 },
    { id: "achievement.consistency.thirty_days", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "consistency.qualifying_days", threshold: 30, rewardPoints: 250, tier: "GOLD", hiddenUntilUnlocked: true, titleKey: "gamification.achievement.consistency_30.title", descriptionKey: "gamification.achievement.consistency_30.description", visibility: "PRIVATE", sortOrder: 200 },
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
    { id: "challenge.v3.consistency.weekly_3_days", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "consistency.qualifying_days", target: 3, rewardPoints: 20, enrollmentPolicy: "AUTO", windowPolicy: "WEEKLY", titleKey: "gamification.challenge.consistency_3.title", descriptionKey: "gamification.challenge.consistency_3.description", visibility: "PRIVATE_STUDY", sortOrder: 10 },
    { id: "challenge.v3.consistency.weekly_5_days", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "consistency.qualifying_days", target: 5, rewardPoints: 40, enrollmentPolicy: "AUTO", windowPolicy: "WEEKLY", titleKey: "gamification.challenge.consistency_5.title", descriptionKey: "gamification.challenge.consistency_5.description", visibility: "PRIVATE_STUDY", sortOrder: 20 },
    { id: "challenge.v3.focus.weekly_60_minutes", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "focus.verified_seconds", target: 3600, rewardPoints: 25, enrollmentPolicy: "AUTO", windowPolicy: "WEEKLY", titleKey: "gamification.challenge.focus_60.title", descriptionKey: "gamification.challenge.focus_60.description", visibility: "PRIVATE_STUDY", sortOrder: 30 },
    { id: "challenge.v3.focus.weekly_120_minutes", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "focus.verified_seconds", target: 7200, rewardPoints: 50, enrollmentPolicy: "AUTO", windowPolicy: "WEEKLY", titleKey: "gamification.challenge.focus_120.title", descriptionKey: "gamification.challenge.focus_120.description", visibility: "PRIVATE_STUDY", sortOrder: 40 },
    { id: "challenge.v3.lectures.weekly_2_completed", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "learning.lecture_completions", target: 2, rewardPoints: 25, enrollmentPolicy: "AUTO", windowPolicy: "WEEKLY", titleKey: "gamification.challenge.lectures_2.title", descriptionKey: "gamification.challenge.lectures_2.description", visibility: "PRIVATE_STUDY", sortOrder: 50 },
    { id: "challenge.v3.lectures.weekly_5_completed", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "learning.lecture_completions", target: 5, rewardPoints: 55, enrollmentPolicy: "AUTO", windowPolicy: "WEEKLY", titleKey: "gamification.challenge.lectures_5.title", descriptionKey: "gamification.challenge.lectures_5.description", visibility: "PRIVATE_STUDY", sortOrder: 60 },
    { id: "challenge.v3.mcq.weekly_20_correct", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "learning.mcq_first_correct", target: 20, rewardPoints: 30, enrollmentPolicy: "AUTO", windowPolicy: "WEEKLY", titleKey: "gamification.challenge.mcq_20.title", descriptionKey: "gamification.challenge.mcq_20.description", visibility: "PRIVATE_STUDY", sortOrder: 70 },
    { id: "challenge.v3.mcq.weekly_50_correct", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "learning.mcq_first_correct", target: 50, rewardPoints: 60, enrollmentPolicy: "AUTO", windowPolicy: "WEEKLY", titleKey: "gamification.challenge.mcq_50.title", descriptionKey: "gamification.challenge.mcq_50.description", visibility: "PRIVATE_STUDY", sortOrder: 80 },
    { id: "challenge.v3.flashcards.weekly_40_recalls", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "learning.flashcard_first_recalls", target: 40, rewardPoints: 35, enrollmentPolicy: "AUTO", windowPolicy: "WEEKLY", titleKey: "gamification.challenge.flashcards_40.title", descriptionKey: "gamification.challenge.flashcards_40.description", visibility: "PRIVATE_STUDY", sortOrder: 90 },
    { id: "challenge.v3.mixed.weekly_study_mix", ruleSetVersion: GAMIFICATION_V3_RULE_SET_VERSION, metricId: "learning.weekly_study_mix", target: 1, rewardPoints: 45, enrollmentPolicy: "AUTO", windowPolicy: "WEEKLY", titleKey: "gamification.challenge.study_mix.title", descriptionKey: "gamification.challenge.study_mix.description", visibility: "PRIVATE_STUDY", sortOrder: 100 },
  ],
  leaderboardDefinitionContracts: [],
});

const sourceBundles = new Map<string, GamificationDefinitionBundle>([
  [gamificationV1.version, gamificationV1],
  [gamificationV2.version, gamificationV2],
  [gamificationV3.version, gamificationV3],
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