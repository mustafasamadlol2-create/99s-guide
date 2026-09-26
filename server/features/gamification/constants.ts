import {
  STUDY_POINTS_CATEGORIES,
} from "../study-points/constants.js";

export const GAMIFICATION_DEFINITION_SCHEMA_VERSION = 1 as const;
export const GAMIFICATION_RULE_VERSION_PATTERN =
  /^gamification-v[1-9][0-9]{0,5}$/u;
export const GAMIFICATION_DEFINITION_CHECKSUM_NAMESPACE =
  "99s-guide:gamification-definition-bundle:v1:";
export const GAMIFICATION_LEVEL_DEFINITION_CHECKSUM_NAMESPACE =
  "99s-guide:gamification-level-definitions:v1:";
export const GAMIFICATION_CHALLENGE_DEFINITION_CHECKSUM_NAMESPACE =
  "99s-guide:gamification-challenge-definitions:v1:";

export const GAMIFICATION_POINT_CATEGORIES = STUDY_POINTS_CATEGORIES;

export const GAMIFICATION_METRIC_IDS = {
  pointsTotal: "points.total",
  pointsFocus: "points.focus",
  pointsMastery: "points.mastery",
  pointsProgress: "points.progress",
  pointsConsistency: "points.consistency",
  focusCompletedSessions: "focus.completed_sessions",
  focusVerifiedSeconds: "focus.verified_seconds",
  groupFocusCompletedRuns: "group_focus.completed_runs",
  groupFocusVerifiedSeconds: "group_focus.verified_seconds",
  consistencyQualifyingDays: "consistency.qualifying_days",
} as const;

export const GAMIFICATION_METRIC_SOURCE_VERSIONS = {
  studyPoints: "study-points-read-model-v1",
  focusSession: "focus-session-canonical-v1",
  groupFocus: "group-focus-participant-summary-v1",
} as const;

export const GAMIFICATION_PRIVACY_CLASSES = [
  "PRIVATE_STUDY",
  "PROFILE_PUBLIC",
  "SYSTEM_INTERNAL",
  "ADMIN_SECURITY",
] as const;