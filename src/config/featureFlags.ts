const buildFlags = (
  import.meta as ImportMeta & {
    env?: Record<string, string | boolean | undefined>;
  }
).env ?? {};

/**
 * Focus Audio is enabled by default; deployments can explicitly disable it.
 */
export const FOCUS_AUDIO_ENABLED =
  buildFlags.VITE_FOCUS_AUDIO_ENABLED !== "false" &&
  buildFlags.VITE_FOCUS_AUDIO_ENABLED !== false;

/**
 * Focus Hub is exposed in development by default. Production builds may expose
 * it only when its matching frontend build flag is explicitly enabled.
 */
export const FOCUS_HUB_V2_ENABLED =
  buildFlags.VITE_FOCUS_HUB_V2_ENABLED === "true" ||
  (buildFlags.DEV === true && buildFlags.VITE_FOCUS_HUB_V2_ENABLED !== "false");

/**
 * Group Focus UI remains opt-in; production visibility requires its explicit
 * frontend flag and the server rollout gate remains authoritative.
 */
export const GROUP_FOCUS_FRONTEND_ENABLED =
  buildFlags.VITE_GROUP_FOCUS_FRONTEND_ENABLED === "true";

export const STUDY_INSIGHTS_FRONTEND_ENABLED =
  buildFlags.VITE_STUDY_INSIGHTS_FRONTEND_ENABLED === "true";

export const ASK_MY_STUDY_DATA_FRONTEND_ENABLED =
  buildFlags.VITE_ASK_MY_STUDY_DATA_FRONTEND_ENABLED === "true";

/**
 * Owner Analytics is opt-in in every environment; server owner checks remain
 * mandatory regardless of frontend visibility.
 */
export const OWNER_ANALYTICS_FRONTEND_ENABLED =
  buildFlags.VITE_OWNER_ANALYTICS_FRONTEND_ENABLED === "true";

/**
 * The operational health dashboard is owner-only and opt-in in every
 * environment.
 */
export const SYSTEM_HEALTH_FRONTEND_ENABLED =
  buildFlags.VITE_SYSTEM_HEALTH_FRONTEND_ENABLED === "true";

export const GROUP_FOCUS_WORKER_URL =
  typeof buildFlags.VITE_GROUP_FOCUS_WORKER_URL === "string"
    ? buildFlags.VITE_GROUP_FOCUS_WORKER_URL.trim()
    : "";