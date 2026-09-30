const buildFlags = (
  import.meta as ImportMeta & {
    env?: Record<string, string | boolean | undefined>;
  }
).env ?? {};

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const DISABLED_VALUES = new Set(["0", "false", "no", "off"]);

function readBuildFlag(name: string, fallback: boolean): boolean {
  const raw = buildFlags[name];

  if (typeof raw === "boolean") return raw;
  if (typeof raw !== "string") return fallback;

  const normalized = raw.trim().toLowerCase();
  if (ENABLED_VALUES.has(normalized)) return true;
  if (DISABLED_VALUES.has(normalized)) return false;
  return fallback;
}

/**
 * Core Study Engine frontends are now release-ready and visible by default in
 * production. Every surface still keeps an explicit build-time kill switch:
 * set the matching VITE_* flag to false to hide it again without code changes.
 *
 * Optional infrastructure-dependent surfaces (Group Focus and AI Study
 * Insights) remain opt-in so an absent Worker/provider cannot expose a dead UI.
 */
export const FOCUS_AUDIO_ENABLED = readBuildFlag(
  "VITE_FOCUS_AUDIO_ENABLED",
  true,
);

export const FOCUS_HUB_V2_ENABLED = readBuildFlag(
  "VITE_FOCUS_HUB_V2_ENABLED",
  true,
);

export const GROUP_FOCUS_FRONTEND_ENABLED = readBuildFlag(
  "VITE_GROUP_FOCUS_FRONTEND_ENABLED",
  false,
);

export const GAMIFICATION_FRONTEND_ENABLED = readBuildFlag(
  "VITE_GAMIFICATION_FRONTEND_ENABLED",
  true,
);

export const SPACED_RECALL_FRONTEND_ENABLED = readBuildFlag(
  "VITE_SPACED_RECALL_FRONTEND_ENABLED",
  true,
);

export const MASTERY_FRONTEND_ENABLED = readBuildFlag(
  "VITE_MASTERY_FRONTEND_ENABLED",
  true,
);

export const STUDY_ANALYZER_FRONTEND_ENABLED = readBuildFlag(
  "VITE_STUDY_ANALYZER_FRONTEND_ENABLED",
  true,
);

export const STUDY_INSIGHTS_FRONTEND_ENABLED = readBuildFlag(
  "VITE_STUDY_INSIGHTS_FRONTEND_ENABLED",
  false,
);

export const OWNER_ANALYTICS_FRONTEND_ENABLED = readBuildFlag(
  "VITE_OWNER_ANALYTICS_FRONTEND_ENABLED",
  true,
);

export const SYSTEM_HEALTH_FRONTEND_ENABLED = readBuildFlag(
  "VITE_SYSTEM_HEALTH_FRONTEND_ENABLED",
  true,
);

export const GROUP_FOCUS_WORKER_URL =
  typeof buildFlags.VITE_GROUP_FOCUS_WORKER_URL === "string"
    ? buildFlags.VITE_GROUP_FOCUS_WORKER_URL.trim()
    : "";
