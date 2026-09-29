const buildFlags = (
  import.meta as ImportMeta & {
    env?: Record<string, string | boolean | undefined>;
  }
).env ?? {};

/**
 * Focus Audio remains opt-in until its audio behavior is explicitly enabled.
 * This flag is build-time only and defaults to false in every environment.
 */
export const FOCUS_AUDIO_ENABLED = buildFlags.VITE_FOCUS_AUDIO_ENABLED === "true";

/**
 * Focus Hub is exposed in development by default, but remains hard-disabled
 * in production builds until a later release explicitly changes this policy.
 * Set VITE_FOCUS_HUB_V2_ENABLED=false to hide it in development.
 */
export const FOCUS_HUB_V2_ENABLED =
  buildFlags.DEV === true && buildFlags.VITE_FOCUS_HUB_V2_ENABLED !== "false";

/**
 * Group Focus UI is an opt-in development surface until its staged rollout.
 * It remains disabled in production regardless of build-time flag values.
 */
export const GROUP_FOCUS_FRONTEND_ENABLED =
  buildFlags.DEV === true && buildFlags.VITE_GROUP_FOCUS_FRONTEND_ENABLED === "true";

/**
 * Gamification UI is opt-in during development and remains disabled in
 * production until the student-facing experience is explicitly ready.
 */
export const GAMIFICATION_FRONTEND_ENABLED =
  buildFlags.DEV === true && buildFlags.VITE_GAMIFICATION_FRONTEND_ENABLED === "true";

/**
 * Recall and Mastery frontends are staged for development only. Production
 * builds stay disabled even when a Vite flag is accidentally set to true.
 */
export const SPACED_RECALL_FRONTEND_ENABLED =
  buildFlags.DEV === true && buildFlags.VITE_SPACED_RECALL_FRONTEND_ENABLED === "true";

export const MASTERY_FRONTEND_ENABLED =
  buildFlags.DEV === true && buildFlags.VITE_MASTERY_FRONTEND_ENABLED === "true";

/**
 * Study Analyzer surfaces are staged in development only. Production builds
 * stay disabled even if a Vite flag is accidentally set to true.
 */
export const STUDY_ANALYZER_FRONTEND_ENABLED =
  buildFlags.DEV === true && buildFlags.VITE_STUDY_ANALYZER_FRONTEND_ENABLED === "true";

export const STUDY_INSIGHTS_FRONTEND_ENABLED =
  buildFlags.DEV === true && buildFlags.VITE_STUDY_INSIGHTS_FRONTEND_ENABLED === "true";

/**
 * Owner Analytics is staged for development only. Production builds stay
 * disabled even if a Vite flag is accidentally set to true.
 */
export const OWNER_ANALYTICS_FRONTEND_ENABLED =
  buildFlags.DEV === true && buildFlags.VITE_OWNER_ANALYTICS_FRONTEND_ENABLED === "true";

/**
 * The operational health dashboard is owner-only and opt-in in development.
 * It remains hidden from production builds until a separate release decision.
 */
export const SYSTEM_HEALTH_FRONTEND_ENABLED =
  buildFlags.DEV === true && buildFlags.VITE_SYSTEM_HEALTH_FRONTEND_ENABLED === "true";

export const GROUP_FOCUS_WORKER_URL =
  typeof buildFlags.VITE_GROUP_FOCUS_WORKER_URL === "string"
    ? buildFlags.VITE_GROUP_FOCUS_WORKER_URL.trim()
    : "";