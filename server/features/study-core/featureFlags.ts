export const STUDY_FEATURE_FLAGS = [
  "STUDY_EVENTS_ENABLED",
  "FOCUS_HUB_ENABLED",
  "FOCUS_RESOURCE_HANDOFF_ENABLED",
  "GROUP_FOCUS_ENABLED",
  "STUDY_POINTS_ENABLED",
  "STUDY_INTEGRITY_ENABLED",
  "GAMIFICATION_ENABLED",
  "SPACED_RECALL_ENABLED",
  "MASTERY_ENABLED",
  "STUDY_ANALYZER_ENABLED",
  "AI_STUDY_INSIGHTS_ENABLED",
  "OWNER_STUDY_ANALYTICS_ENABLED",
] as const;

export type StudyFeatureFlag = (typeof STUDY_FEATURE_FLAGS)[number];

export type StudyFeatureFlagState = Readonly<
  Record<StudyFeatureFlag, boolean>
>;

export const DEFAULT_STUDY_FEATURE_FLAGS: StudyFeatureFlagState = {
  STUDY_EVENTS_ENABLED: false,
  FOCUS_HUB_ENABLED: false,
  FOCUS_RESOURCE_HANDOFF_ENABLED: false,
  GROUP_FOCUS_ENABLED: false,
  STUDY_POINTS_ENABLED: false,
  STUDY_INTEGRITY_ENABLED: false,
  GAMIFICATION_ENABLED: false,
  SPACED_RECALL_ENABLED: false,
  MASTERY_ENABLED: false,
  STUDY_ANALYZER_ENABLED: false,
  AI_STUDY_INSIGHTS_ENABLED: false,
  OWNER_STUDY_ANALYTICS_ENABLED: false,
};

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

/**
 * Environment values are deliberately parsed strictly. Missing, malformed,
 * and explicit false values all leave a feature disabled.
 */
export function parseStudyFeatureFlag(value: unknown): boolean {
  return (
    typeof value === "string" &&
    ENABLED_VALUES.has(value.trim().toLowerCase())
  );
}

export function getStudyFeatureFlags(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): StudyFeatureFlagState {
  const flags = {} as Record<StudyFeatureFlag, boolean>;

  for (const flag of STUDY_FEATURE_FLAGS) {
    flags[flag] = parseStudyFeatureFlag(environment[flag]);
  }

  return flags;
}

export function isStudyFeatureEnabled(
  flag: StudyFeatureFlag,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return getStudyFeatureFlags(environment)[flag];
}