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
    ruleVersion: "mcq-first-correct-v2",
    category: "MASTERY",
    reasonCode: "mcq.first_verified_correct",
    sourceType: "MCQ_ATTEMPT",
    status: "ACTIVE",
  },
  {
    ruleVersion: "flashcard-first-recall-v2",
    category: "MASTERY",
    reasonCode: "flashcard.first_verified_recall",
    sourceType: "FLASHCARD_REVIEW",
    status: "ACTIVE",
  },
  {
    ruleVersion: "recall-objective-correct-v1",
    category: "MASTERY",
    reasonCode: "recall.objective_correct",
    sourceType: "RECALL_ATTEMPT",
    status: "ACTIVE",
  },
  {
    ruleVersion: "lecture-pdf-completion-v1",
    category: "PROGRESS",
    reasonCode: "lecture.pdf_completed",
    sourceType: "LECTURE_RESOURCE",
    status: "ACTIVE",
  },
  {
    ruleVersion: "lecture-notes-completion-v1",
    category: "PROGRESS",
    reasonCode: "lecture.notes_completed",
    sourceType: "LECTURE_RESOURCE",
    status: "ACTIVE",
  },
  {
    ruleVersion: "lecture-video-completion-v1",
    category: "PROGRESS",
    reasonCode: "lecture.video_verified_completed",
    sourceType: "LECTURE_RESOURCE",
    status: "ACTIVE",
  },
  {
    ruleVersion: "mcq-set-pass-v2",
    category: "MASTERY",
    reasonCode: "mcq.set_verified_pass",
    sourceType: "LECTURE_RESOURCE",
    status: "ACTIVE",
  },
  {
    ruleVersion: "lecture-completion-v1",
    category: "PROGRESS",
    reasonCode: "lecture.completed",
    sourceType: "LECTURE_COMPLETION",
    status: "ACTIVE",
  },
] as const satisfies readonly StudyPointsAwardRuleDescriptor[]);

export const FOCUS_COMPLETION_RULE = STUDY_POINTS_AWARD_RULES[0];
export const GROUP_FOCUS_PARTICIPATION_RULE = STUDY_POINTS_AWARD_RULES[1];
export const GROUP_FOCUS_SOCIAL_BONUS_RULE = STUDY_POINTS_AWARD_RULES[2];
export const DAILY_CONSISTENCY_RULE = STUDY_POINTS_AWARD_RULES[3];
export const MCQ_FIRST_CORRECT_RULE = STUDY_POINTS_AWARD_RULES[4];
export const FLASHCARD_FIRST_RECALL_RULE = STUDY_POINTS_AWARD_RULES[5];
export const RECALL_OBJECTIVE_CORRECT_RULE = STUDY_POINTS_AWARD_RULES[6];
export const LECTURE_PDF_COMPLETION_RULE = STUDY_POINTS_AWARD_RULES[7];
export const LECTURE_NOTES_COMPLETION_RULE = STUDY_POINTS_AWARD_RULES[8];
export const LECTURE_VIDEO_COMPLETION_RULE = STUDY_POINTS_AWARD_RULES[9];
export const MCQ_SET_PASS_RULE = STUDY_POINTS_AWARD_RULES[10];
export const LECTURE_COMPLETION_RULE = STUDY_POINTS_AWARD_RULES[11];
export const LECTURE_PDF_COMPLETION_AMOUNT = 5;
export const LECTURE_NOTES_COMPLETION_AMOUNT = 3;
export const LECTURE_VIDEO_COMPLETION_AMOUNT = 3;
export const MCQ_SET_PASS_AMOUNT = 5;
export const MCQ_SET_PASS_MIN_QUESTIONS = 10;
export const MCQ_SET_PASS_MIN_SCORE_PERCENT = 70;
export const LECTURE_COMPLETION_AMOUNT = 8;
export const RECALL_OBJECTIVE_CORRECT_AMOUNT = 2;

export const FOCUS_MINIMUM_SECONDS = 600;
export const GROUP_FOCUS_SOCIAL_BONUS_MINIMUM_SECONDS = 1_500;
export const GROUP_FOCUS_SOCIAL_BONUS_AMOUNT = 2;
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