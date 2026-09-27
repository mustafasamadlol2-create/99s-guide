import { STUDY_ANALYZER_FACT_REGISTRY_VERSION } from "./constants.js";

export type StudyAnalyzerFactDefinition = {
  id: string;
  type: "COUNT" | "RATE_BPS" | "DISTRIBUTION" | "TREND" | "SIGNAL" | "TIMESTAMP";
  source: string;
  window?: "LAST_7_DAYS" | "LAST_30_DAYS" | "CURRENT_SEMESTER" | "LAST_90_DAYS" | "CURRENT";
  unavailableValue: "NULL" | "EMPTY_ARRAY" | "OMITTED";
};

export const STUDY_ANALYZER_FACT_REGISTRY_VERSIONED = STUDY_ANALYZER_FACT_REGISTRY_VERSION;

export const STUDY_ANALYZER_FACT_REGISTRY: readonly StudyAnalyzerFactDefinition[] = [
  { id: "activity.active_days.7d", type: "COUNT", source: "canonical study activity", window: "LAST_7_DAYS", unavailableValue: "NULL" },
  { id: "activity.active_days.30d", type: "COUNT", source: "canonical study activity", window: "LAST_30_DAYS", unavailableValue: "NULL" },
  { id: "activity.active_days.semester", type: "COUNT", source: "canonical study activity", window: "CURRENT_SEMESTER", unavailableValue: "NULL" },
  { id: "focus.meaningful_sessions.30d", type: "COUNT", source: "FocusSession and verified Group Focus participant summaries", window: "LAST_30_DAYS", unavailableValue: "NULL" },
  { id: "focus.verified_seconds.30d", type: "COUNT", source: "FocusSession and verified Group Focus participant summaries", window: "LAST_30_DAYS", unavailableValue: "NULL" },
  { id: "focus.completion_rate.30d", type: "RATE_BPS", source: "terminal solo FocusSession rows", window: "LAST_30_DAYS", unavailableValue: "NULL" },
  { id: "mcq.objective_attempts.30d", type: "COUNT", source: "validated MCQ StudyEvents and eligible RecallAttempt rows", window: "LAST_30_DAYS", unavailableValue: "NULL" },
  { id: "mcq.objective_accuracy.30d", type: "RATE_BPS", source: "deduplicated validated objective outcomes", window: "LAST_30_DAYS", unavailableValue: "NULL" },
  { id: "mcq.repeated_errors.90d", type: "DISTRIBUTION", source: "latest 100 deduplicated objective outcomes", window: "LAST_90_DAYS", unavailableValue: "EMPTY_ARRAY" },
  { id: "flashcards.meaningful_reviews.30d", type: "COUNT", source: "validated flashcard StudyEvents and eligible RecallAttempt rows", window: "LAST_30_DAYS", unavailableValue: "NULL" },
  { id: "recall.periodic_answered.30d", type: "COUNT", source: "private periodic RecallAttempt rows", window: "LAST_30_DAYS", unavailableValue: "NULL" },
  { id: "mastery.effective.needs_review.current", type: "COUNT", source: "fresh LectureRetention projections", window: "CURRENT", unavailableValue: "NULL" },
  { id: "retention.overdue.current", type: "COUNT", source: "fresh LectureRetention projections", window: "CURRENT", unavailableValue: "NULL" },
  { id: "mcq.objective_accuracy.equal_outcome_windows", type: "TREND", source: "deduplicated objective outcomes", window: "LAST_90_DAYS", unavailableValue: "NULL" },
  { id: "activity.active_days.equal_7d_trend", type: "TREND", source: "canonical study activity", window: "LAST_30_DAYS", unavailableValue: "NULL" },
] as const;