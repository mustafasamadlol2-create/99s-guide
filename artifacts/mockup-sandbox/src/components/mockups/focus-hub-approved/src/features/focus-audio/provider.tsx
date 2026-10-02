import { createContext, type ReactNode } from "react";
import type { FocusAudioStoreSnapshot, FocusAudioResult, AmbientTrackId } from "./types";

export interface FocusAudioContextValue extends FocusAudioStoreSnapshot {
  readonly store: {
    subscribe(listener: () => void): () => void;
    getSnapshot(): FocusAudioStoreSnapshot;
  };
  selectAmbient(trackId: AmbientTrackId): Promise<FocusAudioResult>;
  selectUserAudio(file: File): Promise<FocusAudioResult>;
  pickUserAudio(): Promise<FocusAudioResult | { readonly ok: true; readonly cancelled: true }>;
  play(): Promise<FocusAudioResult>;
  pause(): void;
  resume(): Promise<FocusAudioResult>;
  stop(): void;
  clear(): void;
  setVolume(value: number): void;
  setLoop(enabled: boolean): void;
  setPauseOnFocusEnd(enabled: boolean): void;
  onFocusStarted(): void;
  onFocusPaused(): void;
  onFocusResumed(): Promise<FocusAudioResult | void>;
  onFocusCompleted(): void;
  onFocusAbandoned(): void;
}

const snapshot: FocusAudioStoreSnapshot = {
  audio: {
    state: "IDLE",
    sourceType: "NONE",
    volume: 0.5,
    loop: false,
    currentTime: 0,
    duration: null,
  },
  preferences: {
    version: "focus-audio-preferences-v1",
    volume: 0.5,
    ambientTrackId: null,
    userAudioLoop: false,
    lastSourceType: "NONE",
    pauseOnFocusEnd: true,
  },
  initialized: true,
};

const store = {
  subscribe: (_listener: () => void) => () => {},
  getSnapshot: () => snapshot,
};
const ok: FocusAudioResult = { ok: true };

const FocusAudioContextValueFixture: FocusAudioContextValue = {
  ...snapshot,
  store,
  selectAmbient: async () => ok,
  selectUserAudio: async () => ok,
  pickUserAudio: async () => ({ ok: true, cancelled: true }),
  play: async () => ({ ok: false, errorCode: "SOURCE_MISSING" }),
  pause: () => {},
  resume: async () => ({ ok: false, errorCode: "SOURCE_MISSING" }),
  stop: () => {},
  clear: () => {},
  setVolume: () => {},
  setLoop: () => {},
  setPauseOnFocusEnd: () => {},
  onFocusStarted: () => {},
  onFocusPaused: () => {},
  onFocusResumed: async () => {},
  onFocusCompleted: () => {},
  onFocusAbandoned: () => {},
};

export const FocusAudioContext = createContext<FocusAudioContextValue | null>(
  FocusAudioContextValueFixture,
);
export interface FocusAudioProviderProps {
  children: ReactNode;
}

export function FocusAudioProvider({ children }: FocusAudioProviderProps) {
  return (
    <FocusAudioContext.Provider value={FocusAudioContextValueFixture}>
      {children}
    </FocusAudioContext.Provider>
  );
}