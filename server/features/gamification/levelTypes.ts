import type { StudyPointsBalanceReadModel } from "../study-points/types.js";
import type {
  MyAchievementUnlockView,
  MyAchievementView,
} from "./achievementTypes.js";

export type GamificationLevelReconciliationStatus =
  | "IN_SYNC"
  | "LEVEL_STATE_MISSING"
  | "LEVEL_STATE_STALE"
  | "RULE_VERSION_STALE"
  | "INVALID_LEVEL_STATE";

export type GamificationLevelView = {
  level: number;
  titleKey?: string;
  lifetimePoints: number;
  currentLevelMinimumPoints: number;
  nextLevelMinimumPoints: number | null;
  pointsIntoLevel: number;
  pointsToNextLevel: number | null;
  levelProgressRatio: number | null;
  maxLevelReached: boolean;
  ruleSetVersion: string;
  lastEvaluatedAt: string;
};

export type PublicGamificationAchievement = {
  achievementId: string;
  titleKey: string;
  descriptionKey: string;
  unlockedAt: string;
};

export type PublicGamificationProfile = {
  level: number;
  titleKey?: string;
  maxLevelReached: boolean;
  achievements: PublicGamificationAchievement[];
};

export type MyGamificationSummary = {
  ruleSetVersion: string;
  points: {
    totalPoints: number;
    focusPoints: number;
    masteryPoints: number;
    progressPoints: number;
    consistencyPoints: number;
    ledgerPoints: number;
    legacyPoints: number;
  };
  level: GamificationLevelView;
  achievements: MyAchievementView[];
  unlockHistory: MyAchievementUnlockView[];
};

export type GamificationLevelReconciliation = {
  status: GamificationLevelReconciliationStatus;
  expectedLevel: number | null;
  storedLevel: number | null;
  expectedLifetimePoints: number | null;
  storedLifetimePoints: number | null;
  ruleSetVersion: string;
};

export type RefreshedGamificationState = {
  ruleSetVersion: string;
  level: GamificationLevelView;
  points: StudyPointsBalanceReadModel;
  achievementRefresh: {
    ruleSetVersion: string;
    asOf: Date;
    achievementCount: number;
    newlyUnlockedCount: number;
  };
};