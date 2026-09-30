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

/**
 * The completed, infrastructure-independent Study Engine is active by default.
 * Each flag remains an explicit runtime kill switch: setting the corresponding
 * environment value to false/0/no/off disables that feature immediately on the
 * next process start.
 *
 * Features that require separately deployed infrastructure remain opt-in:
 * - Group Focus requires its Worker/Durable Object deployment and signing keys.
 * - AI Study Insights requires the dedicated Workers AI configuration.
 * - D1 leaderboard projection/reads remain optional optimizations with PG
 *   canonical fallback.
 */
export const DEFAULT_STUDY_FEATURE_FLAGS: StudyFeatureFlagState = {
  STUDY_EVENTS_ENABLED: true,
  FOCUS_HUB_ENABLED: true,
  FOCUS_RESOURCE_HANDOFF_ENABLED: true,
  GROUP_FOCUS_ENABLED: false,
  STUDY_POINTS_ENABLED: true,
  STUDY_INTEGRITY_ENABLED: true,
  GAMIFICATION_ENABLED: true,
  SPACED_RECALL_ENABLED: true,
  RECALL_POINTS_ENABLED: true,
  MASTERY_ENABLED: true,
  STUDY_ANALYZER_ENABLED: true,
  AI_STUDY_INSIGHTS_ENABLED: false,
  AI_STUDY_INSIGHTS_CACHE_ENABLED: false,
  ASK_MY_STUDY_DATA_ENABLED: true,
  ASK_MY_STUDY_DATA_AI_ENABLED: false,
  OWNER_STUDY_ANALYTICS_ENABLED: true,
  LEADERBOARD_D1_PROJECTION_ENABLED: false,
  LEADERBOARD_D1_READ_ENABLED: false,
};

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const DISABLED_VALUES = new Set(["0", "false", "no", "off"]);

/**
 * Strict parser used by callers that intentionally want a missing value to be
 * false. Runtime feature resolution below adds the release defaults separately.
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

export function isStudyFeatureEnabled(
  flag: StudyFeatureFlag,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return getStudyFeatureFlags(environment)[flag];
}
