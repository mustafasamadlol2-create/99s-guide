import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import type {
  AppIconId,
  AppIconState,
  NativeAppIconPlugin,
} from "./appIconTypes";

const NativeAppIcon = registerPlugin<NativeAppIconPlugin>("AppIcon");

export function isNativeAppIconPlatform(): boolean {
  return Capacitor.getPlatform() === "ios";
}

export async function getAppIconState(): Promise<AppIconState> {
  if (!isNativeAppIconPlatform()) {
    return { supported: false, iconId: "primary" };
  }

  try {
    const state = await NativeAppIcon.getState();
    if (
      typeof state?.supported === "boolean" &&
      (state.iconId === "primary" ||
        state.iconId === "midnight" ||
        state.iconId === "rose" ||
        state.iconId === "monochrome")
    ) {
      return state;
    }
  } catch {
    // The selector shows the explicit unsupported state when native support
    // is not available in the current shell.
  }

  return { supported: false, iconId: "primary" };
}

export async function setAppIcon(
  iconId: AppIconId,
): Promise<{ iconId: AppIconId }> {
  if (!isNativeAppIconPlatform()) {
    throw new Error("app_icon_unsupported");
  }

  return NativeAppIcon.setIcon({ iconId });
}

export function listenForAppIconActivation(
  onActive: () => void,
): () => void {
  if (!isNativeAppIconPlatform()) {
    return () => {};
  }

  let listener: Promise<PluginListenerHandle> | undefined;
  try {
    listener = CapacitorApp.addListener("appStateChange", (state) => {
      if (state.isActive) onActive();
    });
  } catch {
    return () => {};
  }

  return () => {
    void listener?.then((handle) => handle.remove());
  };
}