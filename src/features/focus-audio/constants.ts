import type { FocusAudioPreferences, FocusAudioSnapshot } from "./types";

export const FOCUS_AUDIO_PREFERENCES_VERSION = "focus-audio-preferences-v1" as const;
export const FOCUS_AUDIO_PREFERENCES_KEY = "99s:focus-audio:preferences:v1";
export const FOCUS_AUDIO_PREFERENCES_MAX_BYTES = 4 * 1024;
export const MAX_LOCAL_AUDIO_FILE_BYTES = 1024 * 1024 * 1024;
export const AUDIO_PROGRESS_MIN_INTERVAL_MS = 250;

export const DEFAULT_FOCUS_AUDIO_PREFERENCES: FocusAudioPreferences = Object.freeze({
  version: FOCUS_AUDIO_PREFERENCES_VERSION,
  volume: 0.5,
  ambientTrackId: null,
  userAudioLoop: false,
  lastSourceType: "NONE",
  pauseOnFocusEnd: true,
});

export const EMPTY_FOCUS_AUDIO_SNAPSHOT: FocusAudioSnapshot = Object.freeze({
  state: "IDLE",
  sourceType: "NONE",
  volume: DEFAULT_FOCUS_AUDIO_PREFERENCES.volume,
  loop: DEFAULT_FOCUS_AUDIO_PREFERENCES.userAudioLoop,
  currentTime: 0,
  duration: null,
});

export const ACCEPTED_AUDIO_MIME_TYPES = Object.freeze([
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
] as const);

export const AUDIO_FILE_PICKER_ACCEPT = "audio/*";