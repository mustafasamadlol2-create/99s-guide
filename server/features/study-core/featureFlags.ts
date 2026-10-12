export const STUDY_FEATURE_FLAGS = [
  "STUDY_EVENTS_ENABLED",
  "FOCUS_HUB_ENABLED",
  "FOCUS_RESOURCE_HANDOFF_ENABLED",
  "GROUP_FOCUS_ENABLED",
  "STUDY_POINTS_ENABLED",
  "STUDY_INTEGRITY_ENABLED",
  "GAMIFICATION_ENABLED",
  "SPACED_RECALL_ENABLED",
  "RECALL_POINTS_ENABLED",
  "MASTERY_ENABLED",
  "STUDY_ANALYZER_ENABLED",
  "AI_STUDY_INSIGHTS_ENABLED",
  "AI_STUDY_INSIGHTS_CACHE_ENABLED",
  "ASK_MY_STUDY_DATA_ENABLED",
  "ASK_MY_STUDY_DATA_AI_ENABLED",
  "OWNER_STUDY_ANALYTICS_ENABLED",
  "LEADERBOARD_D1_PROJECTION_ENABLED",
  "LEADERBOARD_D1_READ_ENABLED",
] as const;

export type StudyFeatureFlag = (typeof STUDY_FEATURE_FLAGS)[number];

export type StudyFeatureFlagState = Readonly<
  Record<StudyFeatureFlag, boolean>
>;

export const CLIENT_VISIBLE_STUDY_FEATURE_FLAGS = [
  "STUDY_POINTS_ENABLED",
  "GAMIFICATION_ENABLED",
  "FOCUS_RESOURCE_HANDOFF_ENABLED",
] as const;

export type ClientVisibleStudyFeatureFlags = Readonly<
  Pick<StudyFeatureFlagState, (typeof CLIENT_VISIBLE_STUDY_FEATURE_FLAGS)[number]>
>;

export const DEFAULT_STUDY_FEATURE_FLAGS: StudyFeatureFlagState = {
  STUDY_EVENTS_ENABLED: true,
  FOCUS_HUB_ENABLED: true,
  FOCUS_RESOURCE_HANDOFF_ENABLED: true,
  GROUP_FOCUS_ENABLED: false,
  STUDY_POINTS_ENABLED: true,
  STUDY_INTEGRITY_ENABLED: true,
  GAMIFICATION_ENABLED: true,
  SPACED_RECALL_ENABLED: false,
  RECALL_POINTS_ENABLED: false,
  MASTERY_ENABLED: false,
  STUDY_ANALYZER_ENABLED: false,
  AI_STUDY_INSIGHTS_ENABLED: false,
  AI_STUDY_INSIGHTS_CACHE_ENABLED: false,
  ASK_MY_STUDY_DATA_ENABLED: false,
  ASK_MY_STUDY_DATA_AI_ENABLED: false,
  OWNER_STUDY_ANALYTICS_ENABLED: false,
  LEADERBOARD_D1_PROJECTION_ENABLED: false,
  LEADERBOARD_D1_READ_ENABLED: false,
};

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const DISABLED_VALUES = new Set(["0", "false", "no", "off"]);

/**
 * Strict parser retained for callers/tests that intentionally treat a missing
 * value as false. Runtime resolution below separately applies release defaults.
 */
export function parseStudyFeatureFlag(value: unknown): boolean {
  return (
    typeof value === "string" &&
    ENABLED_VALUES.has(value.trim().toLowerCase())
  );
}

function resolveStudyFeatureFlag(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (ENABLED_VALUES.has(normalized)) return true;
  if (DISABLED_VALUES.has(normalized)) return false;
  return false;
}

export function getStudyFeatureFlags(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): StudyFeatureFlagState {
  const flags = {} as Record<StudyFeatureFlag, boolean>;

  for (const flag of STUDY_FEATURE_FLAGS) {
    flags[flag] = resolveStudyFeatureFlag(
      environment[flag],
      DEFAULT_STUDY_FEATURE_FLAGS[flag],
    );
  }

  return flags;
}

export function getClientVisibleStudyFeatureFlags(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ClientVisibleStudyFeatureFlags {
  const flags = getStudyFeatureFlags(environment);
  return {
    STUDY_POINTS_ENABLED: flags.STUDY_POINTS_ENABLED,
    GAMIFICATION_ENABLED: flags.GAMIFICATION_ENABLED,
    FOCUS_RESOURCE_HANDOFF_ENABLED: flags.FOCUS_RESOURCE_HANDOFF_ENABLED,
  };
}

export function isStudyFeatureEnabled(
  flag: StudyFeatureFlag,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return getStudyFeatureFlags(environment)[flag];
}