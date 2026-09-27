import { NativeBridge } from "../../core/device/capacitor/nativeBridge";

export interface FocusAudioLifecycleSource {
  subscribe(onActiveChange: (isActive: boolean) => void): () => void;
}

export interface NativeAudioLifecycleBridge {
  addAppLifecycleListener(onChange: (isActive: boolean) => void): () => void;
}

export function createFocusAudioLifecycle(options: {
  nativeBridge?: NativeAudioLifecycleBridge;
} = {}): FocusAudioLifecycleSource {
  if (options.nativeBridge === undefined && typeof document === "undefined") {
    return { subscribe: () => () => undefined };
  }
  const nativeBridge = options.nativeBridge ?? NativeBridge;
  return {
    subscribe(onActiveChange) {
      return nativeBridge.addAppLifecycleListener(onActiveChange);
    },
  };
}