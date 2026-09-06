import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

/**
 * 99's Guide — native container configuration (Capacitor 8).
 *
 * The web application is built once (vite build → dist/) and bundled into the
 * native shell, so the iOS app serves the same assets as the web release.
 * No `server.url` is set: the app is a self-contained native build, not a
 * remote-hybrid shell, and all API traffic goes to the HTTPS backend that is
 * baked in at build time (VITE_API_BASE_URL / src/core/api/api.ts).
 */
const config: CapacitorConfig = {
  appId: "com.nine9sguide.app",
  appName: "99s Guide",
  webDir: "dist",

  ios: {
    // The web layer already accounts for safe-area via env(safe-area-inset-top)
    // in #main-scroll-canvas paddingTop. Using "always" would double-count the
    // safe area (native content inset + CSS env), pushing content too far down.
    contentInset: "never",
    // Vite targets es2022 → iOS 16+ minimum. The Capacitor 8 CLI still reads
    // `ios.minVersion` to stamp the Xcode deployment target, so it is carried
    // through a spread (the public config type no longer declares the key).
    ...({ minVersion: "16.0" } as Record<string, string>),
  },

  plugins: {
    // The app renders its own branded LaunchScreen; hide the native splash
    // immediately and let the web LaunchScreen take over seamlessly.
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: "#052050",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
    },
    StatusBar: {
      overlaysWebView: true,
      backgroundColor: "#000000",
    },
    Keyboard: {
      // Native keyboard handling with automatic view resizing.
      resize: KeyboardResize.Native,
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ["badge", "alert", "sound"],
    },
  },
};

export default config;
