import {
  POINT_CATEGORIES,
  type PointCategory,
} from "../study-core/constants.js";

export const STUDY_POINTS_LEDGER_VERSION = 1 as const;
export const STUDY_POINTS_MAX_ENTRY_AMOUNT = 100_000;
export const STUDY_POINTS_MAX_METADATA_BYTES = 8 * 1024;
export const STUDY_POINTS_DEFAULT_HISTORY_LIMIT = 25;
export const STUDY_POINTS_MAX_HISTORY_LIMIT = 100;
export const LEGACY_POINTS_RULE_VERSION = "legacy-pointslog-v1";
export const LEGACY_POINTS_CATEGORY = "LEGACY" as const;

export const STUDY_POINTS_CATEGORIES = POINT_CATEGORIES;
export type StudyPointsCategory = PointCategory;

export const STUDY_POINTS_SOURCE_TYPES = [
  "FOCUS_SESSION",
  "GROUP_FOCUS_RUN",
  "MCQ_ATTEMPT",
  "FLASHCARD_REVIEW",
  "RECALL_ATTEMPT",
  "DAILY_CONSISTENCY",
  "ADMIN_ADJUSTMENT",
  "LEGACY_POINTS_LOG",
  "REVERSAL",
] as const;

export type StudyPointsSourceType =
  (typeof STUDY_POINTS_SOURCE_TYPES)[number];

export type StudyPointsRuleDescriptor = {
  ruleVersion: string;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
  effectiveFrom?: string;
};

/**
 * Ledger mechanics version only. This is deliberately DRAFT and is not an
 * active reward rule or an award table.
 */
export const STUDY_POINTS_RULE_DESCRIPTORS: readonly StudyPointsRuleDescriptor[] = [
  { ruleVersion: "points-ledger-v1", status: "DRAFT" },
];