import { Capacitor } from "@capacitor/core";
import { NativeBridge } from "../../../core/device/capacitor/nativeBridge";
import { isStandalonePwa } from "../../../core/utils/platform";
import type { FocusClientSource } from "./types";

export interface FocusPlatformSnapshot {
  isNative: boolean;
  platformName: string;
  isStandalone: boolean;
}

export function classifyFocusSource(
  platform: FocusPlatformSnapshot,
): FocusClientSource {
  if (platform.isNative && platform.platformName === "ios") return "ios";
  if (platform.isNative && platform.platformName === "android") return "android";
  return platform.isStandalone ? "pwa" : "web";
}

export function getFocusClientSource(): FocusClientSource {
  return classifyFocusSource({
    isNative: NativeBridge.isNativePlatform() || Capacitor.isNativePlatform(),
    platformName: NativeBridge.getPlatformName() || Capacitor.getPlatform(),
    isStandalone: isStandalonePwa(),
  });
}