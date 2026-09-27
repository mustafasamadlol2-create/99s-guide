export const STUDY_ANALYZER_VERSION = "study-analyzer-v1" as const;
export const STUDY_ANALYZER_FACT_REGISTRY_VERSION = "study-analyzer-facts-v1" as const;
export const STUDY_ANALYZER_TIMEZONE = "Asia/Baghdad" as const;

export const STUDY_ANALYZER_MAX_SOURCE_ROWS = 10_000;
export const STUDY_ANALYZER_MAX_SUBJECTS = 100;
export const STUDY_ANALYZER_MAX_DUE_REVIEWS = 20;
export const STUDY_ANALYZER_MAX_REPEATED_ERRORS = 20;
export const STUDY_ANALYZER_MAX_SIGNALS = 20;
export const STUDY_ANALYZER_MAX_DTO_BYTES = 256 * 1024;

export const STUDY_ANALYZER_LOOKBACK_DAYS = 90;
export const STUDY_ANALYZER_REPEAT_OUTCOME_LIMIT = 100;
export const STUDY_ANALYZER_MIN_SESSION_PATTERN_SESSIONS = 8;
export const STUDY_ANALYZER_MIN_LINKED_PATTERN_SESSIONS = 3;
export const STUDY_ANALYZER_MIN_TIME_OF_DAY_SESSIONS = 10;
export const STUDY_ANALYZER_MIN_MOST_USED_SESSIONS = 5;
export const STUDY_ANALYZER_MIN_OBJECTIVE_TREND_OUTCOMES = 20;
export const STUDY_ANALYZER_OBJECTIVE_TREND_SAMPLE = 20;
export const STUDY_ANALYZER_OBJECTIVE_TREND_DELTA_BPS = 500;
export const STUDY_ANALYZER_CONSISTENCY_CHANGE_DAYS = 2;

export const STUDY_ANALYZER_FOCUS_DURATION_BUCKETS = [
  { id: "10_24_MIN", minimumSeconds: 600, maximumSeconds: 1_499 },
  { id: "25_44_MIN", minimumSeconds: 1_500, maximumSeconds: 2_699 },
  { id: "45_59_MIN", minimumSeconds: 2_700, maximumSeconds: 3_599 },
  { id: "60_89_MIN", minimumSeconds: 3_600, maximumSeconds: 5_399 },
  { id: "90_PLUS_MIN", minimumSeconds: 5_400, maximumSeconds: null },
] as const;

export const STUDY_ANALYZER_TIME_BUCKETS = [
  { id: "MORNING", startHour: 5, endHour: 12 },
  { id: "AFTERNOON", startHour: 12, endHour: 17 },
  { id: "EVENING", startHour: 17, endHour: 22 },
  { id: "NIGHT", startHour: 22, endHour: 5 },
] as const;

export const STUDY_ANALYZER_REPEATED_ERROR_LOOKBACK_DAYS = 90;