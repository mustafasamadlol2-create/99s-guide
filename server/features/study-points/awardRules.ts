import type { StudyPointsAwardRuleDescriptor } from "./awardTypes.js";
import type { StudyPointsCategory } from "./constants.js";

export const STUDY_POINTS_AWARD_RULES = Object.freeze([
  {
    ruleVersion: "focus-completion-v1",
    category: "FOCUS",
    reasonCode: "focus.verified_completion",
    sourceType: "FOCUS_SESSION",
    status: "ACTIVE",
  },
  {
    ruleVersion: "group-focus-participation-v1",
    category: "FOCUS",
    reasonCode: "group_focus.verified_participation",
    sourceType: "GROUP_FOCUS_RUN",
    status: "ACTIVE",
  },
  {
    ruleVersion: "group-focus-participation-v1",
    category: "FOCUS",
    reasonCode: "group_focus.verified_social_bonus",
    sourceType: "GROUP_FOCUS_RUN",
    status: "ACTIVE",
  },
  {
    ruleVersion: "daily-consistency-v1",
    category: "CONSISTENCY",
    reasonCode: "consistency.verified_study_day",
    sourceType: "DAILY_CONSISTENCY",
    status: "ACTIVE",
  },
  {
    ruleVersion: "mcq-verified-set-v1",
    category: "MASTERY",
    reasonCode: "mcq.verified_set",
    sourceType: "MCQ_ATTEMPT",
    status: "INACTIVE_UNSUPPORTED",
  },
  {
    ruleVersion: "flashcard-due-review-v1",
    category: "MASTERY",
    reasonCode: "flashcard.verified_due_review",
    sourceType: "FLASHCARD_REVIEW",
    status: "INACTIVE_UNSUPPORTED",
  },
] as const satisfies readonly StudyPointsAwardRuleDescriptor[]);

export const FOCUS_COMPLETION_RULE = STUDY_POINTS_AWARD_RULES[0];
export const GROUP_FOCUS_PARTICIPATION_RULE = STUDY_POINTS_AWARD_RULES[1];
export const GROUP_FOCUS_SOCIAL_BONUS_RULE = STUDY_POINTS_AWARD_RULES[2];
export const DAILY_CONSISTENCY_RULE = STUDY_POINTS_AWARD_RULES[3];

export const FOCUS_MINIMUM_SECONDS = 600;
export const GROUP_FOCUS_SOCIAL_BONUS_MINIMUM_SECONDS = 1_500;
export const GROUP_FOCUS_SOCIAL_BONUS_AMOUNT = 2;
export const GROUP_FOCUS_SOCIAL_BONUS_MAX_AWARDS_PER_DAY = 3;
export const GROUP_FOCUS_SOCIAL_BONUS_MAX_POINTS_PER_DAY = 6;
export const DAILY_CONSISTENCY_MINIMUM_SECONDS = 1_500;
export const DAILY_CONSISTENCY_AMOUNT = 5;

export function focusCompletionAmount(activeSeconds: number): number | null {
  if (!Number.isSafeInteger(activeSeconds) || activeSeconds < FOCUS_MINIMUM_SECONDS) {
    return null;
  }
  if (activeSeconds < 1_500) return 4;
  if (activeSeconds < 2_700) return 8;
  if (activeSeconds < 3_600) return 12;
  if (activeSeconds < 5_400) return 16;
  return 20;
}

export function isStudyPointsCategory(
  value: unknown,
): value is StudyPointsCategory {
  return value === "FOCUS"
    || value === "MASTERY"
    || value === "PROGRESS"
    || value === "CONSISTENCY";
}