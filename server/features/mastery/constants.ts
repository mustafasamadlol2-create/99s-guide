import { FOCUS_MINIMUM_SECONDS } from "../study-points/awardRules.js";

export const MASTERY_RULE_VERSION = "mastery-v1" as const;
export const MASTERY_OBJECTIVE_WINDOW = 20;
export const MASTERY_FLASHCARD_WINDOW = 20;
export const MASTERY_STUDY_WINDOW_DAYS = 30;
export const MASTERY_MEANINGFUL_FOCUS_SECONDS = FOCUS_MINIMUM_SECONDS;

export const MASTERY_LIMITS = Object.freeze({
  objectiveGoodAttempts: 5,
  objectiveMasteredAttempts: 10,
  objectiveGoodDistinctItems: 5,
  objectiveMasteredDistinctItems: 10,
  minimumDistinctItemsWhenInventoryHasThree: 3,
  objectiveGoodAccuracyPercent: 70,
  objectiveMasteredAccuracyPercent: 85,
  limitedContentGoodAccuracyPercent: 85,
  goodEvidenceScore: 65,
  masteredEvidenceScore: 85,
  objectiveFailureWindow: 3,
  objectiveFailuresForNeedsReview: 2,
  objectiveLowAccuracyMinimumAttempts: 5,
  objectiveLowAccuracyPercent: 50,
  flashcardFailureWindow: 3,
  flashcardFailuresForNeedsReview: 2,
  minimumEvidenceCountForLearning: 2,
  limitedContentGoodRequiresSupportingEvidence: true,
});

export const MASTERY_OBJECTIVE_SAMPLE_CONFIDENCE = Object.freeze([
  0, 20, 35, 50, 65, 80, 80, 80, 90, 90, 100,
] as const);

export const MASTERY_FLASHCARD_SAMPLE_CONFIDENCE = Object.freeze([
  0, 25, 40, 55, 70, 85, 85, 85, 100,
] as const);

export const MASTERY_STUDY_SCORE_TIERS = Object.freeze([
  { minimumSeconds: 90 * 60, score: 10 },
  { minimumSeconds: 45 * 60, score: 7 },
  { minimumSeconds: 25 * 60, score: 5 },
  { minimumSeconds: 10 * 60, score: 3 },
] as const);