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

export const GROUP_FOCUS_WORKER_URL =
  typeof buildFlags.VITE_GROUP_FOCUS_WORKER_URL === "string"
    ? buildFlags.VITE_GROUP_FOCUS_WORKER_URL.trim()
    : "";