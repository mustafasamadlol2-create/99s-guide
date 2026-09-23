export const RECALL_CONTENT_TYPES = ["MCQ", "FLASHCARD"] as const;
export type RecallContentType = (typeof RECALL_CONTENT_TYPES)[number];

export const RECALL_RESPONSE_STATUSES = [
  "CORRECT",
  "INCORRECT",
  "SKIPPED",
] as const;
export type RecallResponseStatus = (typeof RECALL_RESPONSE_STATUSES)[number];

/**
 * Skip has zero punishment. Recall must not block app use; later selection is
 * retention-aware and may use any eligible previously studied Lecture.
 */