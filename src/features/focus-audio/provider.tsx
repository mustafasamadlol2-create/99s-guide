import React, {
  createContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { pickLocalAudioFile } from "./localFile";
import { createFocusAudioStore, type FocusAudioStore } from "./store";
import type {
  AmbientTrackId,
  FocusAudioResult,
  FocusAudioStoreSnapshot,
} from "./types";

export interface FocusAudioContextValue extends FocusAudioStoreSnapshot {
  readonly store: FocusAudioStore;
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
}

export const FocusAudioContext = createContext<FocusAudioContextValue | null>(null);

export interface FocusAudioProviderProps {
  children: React.ReactNode;
}

/**
 * App-level, headless provider. It creates one store/engine and starts no audio.
 * The provider is dynamically mounted only when FOCUS_AUDIO_ENABLED is true.
 */
export function FocusAudioProvider({ children }: FocusAudioProviderProps) {
  const [store] = useState(() => createFocusAudioStore());
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  useEffect(() => {
    void store.initialize();
    return () => store.destroy();
  }, [store]);

  const value = useMemo<FocusAudioContextValue>(() => ({
    ...snapshot,
    store,
    selectAmbient: (trackId) => store.selectAmbient(trackId),
    selectUserAudio: (file) => store.selectUserAudio(file),
    pickUserAudio: async () => {
      const file = await pickLocalAudioFile();
      if (!file) return { ok: true, cancelled: true };
      return store.selectUserAudio(file);
    },
    play: () => store.play(),
    pause: () => store.pause(),
    resume: () => store.resume(),
    stop: () => store.stop(),
    clear: () => store.clear(),
    setVolume: (volume) => store.setVolume(volume),
    setLoop: (enabled) => store.setLoop(enabled),
    setPauseOnFocusEnd: (enabled) => store.setPauseOnFocusEnd(enabled),
  }), [snapshot, store]);

  return (
    <FocusAudioContext.Provider value={value}>
      {children}
    </FocusAudioContext.Provider>
  );
}