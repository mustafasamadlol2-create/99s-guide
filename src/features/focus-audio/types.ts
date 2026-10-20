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

export interface FocusSharedSound {
  readonly id: string;
  readonly name: string;
  readonly playbackUrl: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sortOrder: number;
  readonly isEnabled: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

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
  /** Display label for any selected source, including shared owner-managed sounds. */
  readonly sourceDisplayName?: string;
  /** Temporary object URL for embedded local artwork; never persisted or sent to a server. */
  readonly userAudioArtworkUrl?: string;
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