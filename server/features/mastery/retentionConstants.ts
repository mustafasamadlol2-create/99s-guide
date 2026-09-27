import type { LectureMasteryState } from "@prisma/client";
import type {
  LectureRetentionForgettingEvidenceKind,
  LectureRetentionReviewState,
} from "@prisma/client";

export const RETENTION_RULE_VERSION = "retention-v1" as const;
export const RETENTION_MEMORY_LOOKBACK_DAYS = 180;
export const RETENTION_MEMORY_OUTCOME_WINDOW = 20;
export const RETENTION_FORGETTING_MIN_SEPARATION_MS = 24 * 60 * 60 * 1000;
export const RETENTION_DECAY_POINTS_PER_MISSED_INTERVAL = 10;
export const RETENTION_DEFAULT_REVIEW_LIMIT = 20;
export const RETENTION_MAX_REVIEW_LIMIT = 100;
export const RETENTION_MAX_REFRESH_LECTURES = 100;

export const RETENTION_INTERVAL_MS: Record<LectureMasteryState, number | null> = {
  NOT_STARTED: null,
  STARTED: 24 * 60 * 60 * 1000,
  LEARNING: 3 * 24 * 60 * 60 * 1000,
  NEEDS_REVIEW: null,
  GOOD: 7 * 24 * 60 * 60 * 1000,
  MASTERED: 14 * 24 * 60 * 60 * 1000,
};

export const RETENTION_SCORE_BANDS: Record<
  LectureMasteryState,
  { min: number; max: number }
> = {
  NOT_STARTED: { min: 0, max: 0 },
  STARTED: { min: 1, max: 39 },
  LEARNING: { min: 40, max: 64 },
  NEEDS_REVIEW: { min: 0, max: 39 },
  GOOD: { min: 65, max: 84 },
  MASTERED: { min: 85, max: 100 },
};

export const RETENTION_URGENCY_BY_REVIEW_STATE: Record<
  Exclude<LectureRetentionReviewState, "INSUFFICIENT_EVIDENCE">,
  number
> = {
  FRESH: 10,
  DUE_SOON: 35,
  DUE: 70,
  OVERDUE: 100,
};

export const RETENTION_FORGETTING_KINDS = [
  "NONE",
  "OBJECTIVE",
  "SELF_REPORTED",
  "MIXED",
] as const satisfies readonly LectureRetentionForgettingEvidenceKind[];

export const RETENTION_REVIEW_STATES = [
  "INSUFFICIENT_EVIDENCE",
  "FRESH",
  "DUE_SOON",
  "DUE",
  "OVERDUE",
] as const satisfies readonly LectureRetentionReviewState[];