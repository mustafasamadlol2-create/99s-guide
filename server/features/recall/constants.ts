import { RECALL_CONTENT_TYPES } from "../study-core/recall.js";

export const RECALL_ITEM_TYPES = RECALL_CONTENT_TYPES;
export type RecallItemType = (typeof RECALL_ITEM_TYPES)[number];

export const RECALL_ATTEMPT_STATUSES = [
  "PRESENTED",
  "ANSWERED",
  "SKIPPED",
  "EXPIRED",
] as const;
export type RecallAttemptStatus = (typeof RECALL_ATTEMPT_STATUSES)[number];

export const RECALL_MCQ_OPTIONS = ["A", "B", "C", "D"] as const;
export type RecallMcqOption = (typeof RECALL_MCQ_OPTIONS)[number];

// These values mirror the existing Flashcard Recall UI and
// FlashcardProgress vocabulary. They remain client-observed self-reports.
export const RECALL_FLASHCARD_RATINGS = ["hard", "medium", "easy"] as const;
export type RecallFlashcardRating = (typeof RECALL_FLASHCARD_RATINGS)[number];

export const RECALL_ANSWER_KINDS = [
  "MCQ_OPTION",
  "FLASHCARD_RECALL_RATING",
] as const;
export type RecallAnswerKind = (typeof RECALL_ANSWER_KINDS)[number];

export const RECALL_OUTCOMES = [
  "CORRECT",
  "INCORRECT",
  "SELF_REPORTED_HARD",
  "SELF_REPORTED_MEDIUM",
  "SELF_REPORTED_EASY",
] as const;
export type RecallAnswerOutcome = (typeof RECALL_OUTCOMES)[number];

export const RECALL_TERMINAL_OUTCOMES = [
  ...RECALL_OUTCOMES,
  "SKIPPED",
  "EXPIRED",
] as const;
export type RecallTerminalOutcome = (typeof RECALL_TERMINAL_OUTCOMES)[number];

export const RECALL_PRIVACY_CLASS = "PRIVATE_STUDY" as const;

export function outcomeForFlashcardRating(
  rating: RecallFlashcardRating,
): RecallAnswerOutcome {
  switch (rating) {
    case "hard":
      return "SELF_REPORTED_HARD";
    case "medium":
      return "SELF_REPORTED_MEDIUM";
    case "easy":
      return "SELF_REPORTED_EASY";
  }
}