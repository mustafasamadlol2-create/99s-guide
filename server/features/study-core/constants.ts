/**
 * Versions describe shared contracts, not database schemas.
 * Increment a contract version only when its serialized meaning changes.
 */
export const STUDY_EVENT_SCHEMA_VERSION = 1;
export const PROJECTION_CONTRACT_VERSION = 1;
export const FOCUS_STATE_MACHINE_VERSION = 1;
export const POINTS_CONTRACT_VERSION = 1;
export const MASTERY_CONTRACT_VERSION = 1;

export const POINT_CATEGORIES = [
  "FOCUS",
  "MASTERY",
  "PROGRESS",
  "CONSISTENCY",
] as const;

export type PointCategory = (typeof POINT_CATEGORIES)[number];

export const MASTERY_STATES = [
  "NOT_STARTED",
  "STARTED",
  "LEARNING",
  "NEEDS_REVIEW",
  "GOOD",
  "MASTERED",
] as const;

export type MasteryState = (typeof MASTERY_STATES)[number];

export const LEADERBOARD_PERIODS = [
  "WEEKLY",
  "MONTHLY",
  "SEMESTER",
  "ALL_TIME",
] as const;

export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];
export const DEFAULT_LEADERBOARD_PERIOD: LeaderboardPeriod = "WEEKLY";