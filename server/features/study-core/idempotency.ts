export const IDEMPOTENCY_SCOPES = [
  "focus_start",
  "focus_completion",
  "group_summary",
  "mcq_attempt",
  "flashcard_review",
  "recall_response",
  "points_award",
  "achievement_award",
  "challenge_completion",
  "offline_replay",
] as const;

export type IdempotencyScope = (typeof IDEMPOTENCY_SCOPES)[number];

export const IDEMPOTENCY_RESULTS = [
  "FIRST_SEEN",
  "REPLAY_SAME_PAYLOAD",
  "CONFLICTING_PAYLOAD",
] as const;

export type IdempotencyResult = (typeof IDEMPOTENCY_RESULTS)[number];