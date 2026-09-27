export type FocusAudioState =
  | "IDLE"
  | "LOADING"
  | "READY"
  | "PLAYING"
  | "PAUSED"
  | "INTERRUPTED"
  | "ERROR";

export type FocusAudioSourceType = "NONE" | "AMBIENT" | "USER_AUDIO";

export type FocusAudioErrorCode =
  | "UNSUPPORTED_AUDIO"
  | "AUDIO_LOAD_FAILED"
  | "AUDIO_PLAY_FAILED"
  | "SOURCE_MISSING"
  | "AUTOPLAY_BLOCKED"
  | "LOCAL_FILE_UNAVAILABLE";

export type AmbientTrackId = string;

export interface FocusAmbientTrack {
  readonly id: AmbientTrackId;
  readonly labelKey: string;
  /** Bundled same-origin asset path only. Remote URLs are rejected by the engine. */
  readonly source: string;
  readonly loop: true;
}

export interface FocusAudioSnapshot {
  readonly state: FocusAudioState;
  readonly sourceType: FocusAudioSourceType;
  readonly ambientTrackId?: AmbientTrackId;
  /** Basename only. Never persisted or sent to a server. */
  readonly userAudioDisplayName?: string;
  readonly volume: number;
  readonly loop: boolean;
  readonly currentTime: number;
  readonly duration: number | null;
  readonly errorCode?: FocusAudioErrorCode;
}

export interface FocusAudioPreferences {
  readonly version: "focus-audio-preferences-v1";
  readonly volume: number;
  readonly ambientTrackId: AmbientTrackId | null;
  readonly userAudioLoop: boolean;
  readonly lastSourceType: FocusAudioSourceType;
  readonly pauseOnFocusEnd: boolean;
}

export interface FocusAudioStoreSnapshot {
  readonly audio: FocusAudioSnapshot;
  readonly preferences: FocusAudioPreferences;
  readonly initialized: boolean;
}

export type FocusAudioListener = () => void;

export interface FocusAudioResult {
  readonly ok: boolean;
  readonly errorCode?: FocusAudioErrorCode;
}