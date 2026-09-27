const buildFlags = (
  import.meta as ImportMeta & { env?: Record<string, string | undefined> }
).env ?? {};

/**
 * Keep Focus Audio disabled until its consuming Focus UI is ready.
 * This flag is build-time only and defaults to false in every environment.
 */
export const FOCUS_AUDIO_ENABLED = buildFlags.VITE_FOCUS_AUDIO_ENABLED === "true";