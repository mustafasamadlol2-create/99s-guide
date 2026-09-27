import { useContext, useSyncExternalStore } from "react";
import { FocusAudioContext } from "./provider";

export function useFocusAudio() {
  const context = useContext(FocusAudioContext);
  if (!context) {
    throw new Error("FocusAudioProvider is not mounted. Check FOCUS_AUDIO_ENABLED before using Focus Audio.");
  }
  return context;
}

export function useFocusAudioSnapshot() {
  const { store } = useFocusAudio();
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}