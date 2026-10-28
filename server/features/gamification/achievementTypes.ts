import type { AchievementDefinition } from "./types.js";

export type AchievementRefreshResult = {
  ruleSetVersion: string;
  asOf: Date;
  achievementCount: number;
  newlyUnlockedCount: number;
  rewardPointsAwarded: number;
};

export type MyAchievementView = {
  achievementId: string;
  ruleSetVersion: string;
  metricId: string;
  titleKey: string;
  descriptionKey: string;
  visibility: AchievementDefinition["visibility"];
  tier?: AchievementDefinition["tier"];
  sortOrder: number;
  rewardPoints: number;
  hidden: boolean;
  currentValue: number | boolean;
  targetValue: number | boolean;
  progressCompleted: boolean;
  unlocked: boolean;
  lastEvaluatedAt: string;
  unlockedAt: string | null;
  unlockedUnderRuleSetVersion: string | null;
};

export type MyAchievementUnlockView = {
  achievementId: string;
  unlockedUnderRuleSetVersion: string;
  metricId: string;
  titleKey: string;
  descriptionKey: string;
  visibility: AchievementDefinition["visibility"];
  tier?: AchievementDefinition["tier"];
  rewardPoints: number;
  metricValueAtUnlock: number | boolean;
  targetValueAtUnlock: number | boolean;
  unlockedAt: string;
};