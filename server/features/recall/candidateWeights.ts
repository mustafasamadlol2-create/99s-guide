export const RECALL_CANDIDATE_VERSION = "recall-candidate-v1" as const;

export const RECALL_CANDIDATE_WEIGHTS = Object.freeze({
  weakness: 50,
  forgettingUrgency: 35,
  recency: 15,
});

export const RECALL_CANDIDATE_LIMITS = Object.freeze({
  maxRawCandidates: 500,
  maxMcqsPerLecture: 50,
  maxFlashcardsPerLecture: 50,
  maxMeaningfulHistory: 10,
  historyWindowDays: 180,
  meaningfulFocusSeconds: 600,
  defaultPreviewLimit: 10,
  maxPreviewLimit: 50,
});

export const RECALL_CANDIDATE_ITEM_TYPE_ORDER = Object.freeze({
  MCQ: 0,
  FLASHCARD: 1,
} as const);

export const RECALL_CANDIDATE_DAY_MS = 24 * 60 * 60 * 1000;
export const RECALL_CANDIDATE_HOUR_MS = 60 * 60 * 1000;