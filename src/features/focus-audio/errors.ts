import type { FocusAudioErrorCode } from "./types";

export function safeAudioErrorCode(error: unknown): FocusAudioErrorCode {
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "NotAllowedError"
  ) {
    return "AUTOPLAY_BLOCKED";
  }
  return "AUDIO_PLAY_FAILED";
}

export function isFocusAudioErrorCode(value: unknown): value is FocusAudioErrorCode {
  return value === "UNSUPPORTED_AUDIO" ||
    value === "AUDIO_LOAD_FAILED" ||
    value === "AUDIO_PLAY_FAILED" ||
    value === "SOURCE_MISSING" ||
    value === "AUTOPLAY_BLOCKED" ||
    value === "LOCAL_FILE_UNAVAILABLE";
}