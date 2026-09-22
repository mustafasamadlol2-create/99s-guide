import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import {
  APP_ICON_IDS,
  type AppIconId,
  type AppIconState,
  type NativeAppIconPlugin,
} from "./appIconTypes";

const NativeAppIcon = registerPlugin<NativeAppIconPlugin>("AppIcon");

const APP_ICON_STORAGE_KEY = "99s-guide:device-app-icon";
export const APP_ICON_CHANGE_EVENT = "99s-guide:app-icon-change";

const APP_ICON_ASSETS: Record<AppIconId, string> = {
  primary: "/app-icons/primary.png",
  midnight: "/app-icons/midnight.png",
  rose: "/app-icons/rose.png",
  monochrome: "/app-icons/monochrome.png",
};


function isAppIconId(value: unknown): value is AppIconId {
  return typeof value === "string" && (APP_ICON_IDS as readonly string[]).includes(value);
}

export function isNativeAppIconPlatform(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

export function getAppIconAssetSrc(iconId: AppIconId): string {
  return APP_ICON_ASSETS[iconId];
}

export function getStoredAppIconId(): AppIconId {
  if (typeof window === "undefined") return "primary";
  try {
    const stored = window.localStorage.getItem(APP_ICON_STORAGE_KEY);
    return isAppIconId(stored) ? stored : "primary";
  } catch {
    return "primary";
  }
}

function persistAppIconId(iconId: AppIconId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(APP_ICON_STORAGE_KEY, iconId);
  } catch {
    // Private browsing / storage policy failures must not block the selection.
  }
}

function upsertIconLink(rel: string, href: string, sizes?: string): void {
  if (typeof document === "undefined") return;
  let node = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!node) {
    node = document.createElement("link");
    node.rel = rel;
    document.head.appendChild(node);
  }
  node.href = href;
  if (sizes) node.sizes = sizes;
}

function updateInstallManifest(iconId: AppIconId): void {
  if (typeof document === "undefined") return;
  const manifestLink = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (manifestLink) manifestLink.href = `/app-icons/manifest-${iconId}.json`;
}

/**
 * Applies the selected device icon to web/PWA chrome and exposes it to in-app
 * branding. The OS launcher icon is handled separately by the native iOS plugin.
 */
export function applyAppIconPresentation(iconId: AppIconId): void {
  if (typeof document === "undefined") return;

  const changed = document.documentElement.dataset.appIcon !== iconId;
  const src = getAppIconAssetSrc(iconId);
  document.documentElement.dataset.appIcon = iconId;
  upsertIconLink("icon", src);
  upsertIconLink("shortcut icon", src);
  upsertIconLink("apple-touch-icon", src, "512x512");
  updateInstallManifest(iconId);

  if (changed && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<AppIconId>(APP_ICON_CHANGE_EVENT, { detail: iconId }),
    );
  }
}

export function initializeAppIconPresentation(): void {
  applyAppIconPresentation(getStoredAppIconId());
}

export async function getAppIconState(): Promise<AppIconState> {
  const storedIconId = getStoredAppIconId();
  applyAppIconPresentation(storedIconId);

  if (!isNativeAppIconPlatform()) {
    return {
      supported: true,
      nativeSupported: false,
      iconId: storedIconId,
    };
  }

  try {
    const nativeState = await NativeAppIcon.getState();
    if (nativeState?.supported && isAppIconId(nativeState.iconId)) {
      persistAppIconId(nativeState.iconId);
      applyAppIconPresentation(nativeState.iconId);
      return {
        supported: true,
        nativeSupported: true,
        iconId: nativeState.iconId,
      };
    }
  } catch {
    // The web/in-app device icon remains available even if an older native shell
    // does not yet expose the alternate-icon plugin.
  }

  return {
    supported: true,
    nativeSupported: false,
    iconId: storedIconId,
  };
}

export async function setAppIcon(
  iconId: AppIconId,
): Promise<{ iconId: AppIconId; nativeApplied: boolean }> {
  persistAppIconId(iconId);
  applyAppIconPresentation(iconId);

  if (!isNativeAppIconPlatform()) {
    return { iconId, nativeApplied: false };
  }

  try {
    const nativeState = await NativeAppIcon.getState();
    if (nativeState?.supported) {
      const result = await NativeAppIcon.setIcon({ iconId });
      if (isAppIconId(result?.iconId)) {
        persistAppIconId(result.iconId);
        applyAppIconPresentation(result.iconId);
        return { iconId: result.iconId, nativeApplied: true };
      }
    }
  } catch {
    // Keep the selected in-app/web icon. A new native build can additionally
    // update the launcher icon once the plugin/assets are present.
  }

  return { iconId, nativeApplied: false };
}

export function listenForAppIconActivation(
  onActive: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const handlePresentationChange = () => onActive();
  const handleStorage = (event: StorageEvent) => {
    if (event.key === APP_ICON_STORAGE_KEY) onActive();
  };
  window.addEventListener(APP_ICON_CHANGE_EVENT, handlePresentationChange);
  window.addEventListener("storage", handleStorage);

  let listener: Promise<PluginListenerHandle> | undefined;
  if (isNativeAppIconPlatform()) {
    try {
      listener = CapacitorApp.addListener("appStateChange", (state) => {
        if (state.isActive) onActive();
      });
    } catch {
      listener = undefined;
    }
  }

  return () => {
    window.removeEventListener(APP_ICON_CHANGE_EVENT, handlePresentationChange);
    window.removeEventListener("storage", handleStorage);
    void listener?.then((handle) => handle.remove());
  };
}
