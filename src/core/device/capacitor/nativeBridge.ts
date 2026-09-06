/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Capacitor } from "@capacitor/core";
import { Keyboard, KeyboardInfo } from "@capacitor/keyboard";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";
import {
  App as CapacitorApp,
  URLOpenListenerEvent,
  AppState,
} from "@capacitor/app";
import {
  PushNotifications,
  Token,
  PermissionStatus as PushPermissionStatus,
  ActionPerformed,
} from "@capacitor/push-notifications";
import { Browser } from "@capacitor/browser";
import { AppLauncher } from "@capacitor/app-launcher";
import { Network } from "@capacitor/network";
import { getApiBaseUrl } from "../../api/api";
import CapExternalOpener from "./externalOpener";

// --- Global Interface Declarations ---
interface KeyboardState {
  isOpen: boolean;
  keyboardHeight: number;
}

// Global deep link listener type
type DeepLinkHandler = (
  url: string,
  path: string,
  queryParams: Record<string, string>,
) => void;

class NativeBridgeManager {
  private isNative: boolean;
  private currentOnlineStatus =
    typeof navigator === "undefined" ? true : navigator.onLine;
  private deepLinkListeners: Set<DeepLinkHandler> = new Set();
  private onlineStatusListeners: Set<(isOnline: boolean) => void> = new Set();
  private keyboardListeners: Set<(state: KeyboardState) => void> = new Set();

  constructor() {
    this.isNative = Capacitor.isNativePlatform();
    this.initializeWebNetworkListeners();
  }

  /**
   * Check if running on native iOS/Android
   */
  public isNativePlatform(): boolean {
    return this.isNative;
  }

  /**
   * Get current platform name ('ios', 'android', 'web')
   */
  public getPlatformName(): string {
    return Capacitor.getPlatform();
  }

  // ==========================================
  // 1. Core Application Lifecycle & Booting
  // ==========================================

  /**
   * Configure edge-to-edge / full-screen native UI at launch.
   * Must be called once on startup before any status-bar style calls.
   * - Android: makes the WebView extend behind the status bar and navigation bar.
   * - iOS: handled declaratively via apple-mobile-web-app-status-bar-style and
   *        contentInset: 'always' in capacitor.config.ts.
   */
  public async initializeFullScreen(): Promise<void> {
    if (!this.isNative) return;
    try {
      await StatusBar.setOverlaysWebView({ overlay: true });
    } catch (_) {
      // Android 15+ deprecates this flag; edge-to-edge is the platform default
      // there, so silently ignoring the error is correct.
    }
  }

  /**
   * Hide initial native launch splash screen
   */
  public async hideSplashScreen(): Promise<void> {
    try {
      if (this.isNative) {
        await SplashScreen.hide();
      }
    } catch (err) {}
  }

  /**
   * Monitor application active/background lifecycle changes
   */
  public addAppLifecycleListener(
    onChange: (isActive: boolean) => void,
  ): () => void {
    if (!this.isNative) {
      const handleVisibilityChange = () => {
        onChange(document.visibilityState === "visible");
      };
      document.addEventListener("visibilitychange", handleVisibilityChange);
      return () => {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      };
    }

    try {
      const listenerPromise = CapacitorApp.addListener(
        "appStateChange",
        (state: AppState) => {
          onChange(state.isActive);
        },
      );

      return () => {
        listenerPromise.then((handler) => handler.remove());
      };
    } catch (err) {
      return () => {};
    }
  }

  /**
   * Register handler for the native hardware back button
   */
  public registerBackButtonListener(onBack: () => void): () => void {
    if (!this.isNative) return () => {};
    try {
      const backPromise = CapacitorApp.addListener("backButton", () => {
        onBack();
      });
      return () => {
        backPromise.then((h) => h.remove());
      };
    } catch (err) {
      return () => {};
    }
  }

  // ==========================================
  // 2. Status Bar Control
  // ==========================================

  public async setStatusBarStyle(theme: "light" | "dark"): Promise<void> {
    if (!this.isNative) return;
    try {
      await StatusBar.setStyle({
        style: theme === "dark" ? Style.Dark : Style.Light,
      });
      await StatusBar.setBackgroundColor({
        color: theme === "dark" ? "#000000" : "#FFFFFF",
      });
    } catch (err) {}
  }

  public async showStatusBar(): Promise<void> {
    if (!this.isNative) return;
    try {
      await StatusBar.show();
    } catch (err) {}
  }

  public async hideStatusBar(): Promise<void> {
    if (!this.isNative) return;
    try {
      await StatusBar.hide();
    } catch (err) {}
  }

  // ==========================================
  // 3. Native Keyboard Behavior & Spacing Insets
  // ==========================================

  public listenToKeyboard(
    onUpdate: (state: KeyboardState) => void,
  ): () => void {
    this.keyboardListeners.add(onUpdate);

    if (!this.isNative) {
      const handleFocusIn = (e: FocusEvent) => {
        const target = e.target as HTMLElement;
        if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) {
          onUpdate({ isOpen: true, keyboardHeight: 280 });
        }
      };

      const handleFocusOut = () => {
        onUpdate({ isOpen: false, keyboardHeight: 0 });
      };

      document.addEventListener("focusin", handleFocusIn);
      document.addEventListener("focusout", handleFocusOut);

      return () => {
        this.keyboardListeners.delete(onUpdate);
        document.removeEventListener("focusin", handleFocusIn);
        document.removeEventListener("focusout", handleFocusOut);
      };
    }

    try {
      const willShowPromise = Keyboard.addListener(
        "keyboardWillShow",
        (info: KeyboardInfo) => {
          onUpdate({ isOpen: true, keyboardHeight: info.keyboardHeight });
        },
      );

      const willHidePromise = Keyboard.addListener("keyboardWillHide", () => {
        onUpdate({ isOpen: false, keyboardHeight: 0 });
      });

      return () => {
        this.keyboardListeners.delete(onUpdate);
        willShowPromise.then((h) => h.remove());
        willHidePromise.then((h) => h.remove());
      };
    } catch (err) {
      return () => {
        this.keyboardListeners.delete(onUpdate);
      };
    }
  }

  public async hideKeyboard(): Promise<void> {
    try {
      if (this.isNative) {
        await Keyboard.hide();
      } else {
        const activeNode = document.activeElement as HTMLElement;
        if (activeNode) activeNode.blur();
      }
    } catch (err) {}
  }

  // ==========================================
  // 4. Deep Links / Universal Link Integrations
  // ==========================================

  public registerDeepLinkListener(listener: DeepLinkHandler): () => void {
    this.deepLinkListeners.add(listener);

    if (this.isNative) {
      try {
        const handleOpenUrl = (event: URLOpenListenerEvent) => {
          this.parseAndBroadcastLink(event.url);
        };
        const appUrlPromise = CapacitorApp.addListener(
          "appUrlOpen",
          handleOpenUrl,
        );

        CapacitorApp.getLaunchUrl().then((launchData) => {
          if (launchData?.url) {
            this.parseAndBroadcastLink(launchData.url);
          }
        });

        return () => {
          this.deepLinkListeners.delete(listener);
          appUrlPromise.then((h) => h.remove());
        };
      } catch (err) {}
    }

    return () => {
      this.deepLinkListeners.delete(listener);
    };
  }

  private parseAndBroadcastLink(urlString: string): void {
    try {
      let parsedUrl: URL;
      if (urlString.startsWith("http://") || urlString.startsWith("https://")) {
        parsedUrl = new URL(urlString);
      } else {
        const cleanUrl = urlString.replace(
          /^[a-zA-Z0-9_-]+:\/\//,
          "https://native-app/",
        );
        parsedUrl = new URL(cleanUrl);
      }

      const path = parsedUrl.pathname;
      const queryParams: Record<string, string> = {};
      parsedUrl.searchParams.forEach((val, key) => {
        queryParams[key] = val;
      });

      this.deepLinkListeners.forEach((listener) => {
        try {
          listener(urlString, path, queryParams);
        } catch (e) {}
      });
    } catch (err) {}
  }

  // ==========================================

  private pushChannelCreated: boolean = false;

  private readonly pushEnabledForRelease = false;

  public async setupPushNotifications(
    onTokenReceived: (token: string) => void,
    onNotificationReceived: (notification: any) => void,
  ): Promise<() => void> {
    if (!this.isNative || !this.pushEnabledForRelease) {
      return () => {};
    }

    try {
      let permStatus = await PushNotifications.checkPermissions();

      if (permStatus.receive === "prompt") {
        permStatus = await PushNotifications.requestPermissions();
      }

      if (permStatus.receive !== "granted") {
        return () => {};
      }

      if (!this.pushChannelCreated) {
        try {
          await PushNotifications.createChannel({
            id: "default",
            name: "General Notifications",
            description: "Important updates and announcements",
            importance: 5,
            visibility: 1,
          });
          this.pushChannelCreated = true;
        } catch (err) {}
      }

      await PushNotifications.register();

      const h1 = await PushNotifications.addListener(
        "registration",
        (token: Token) => {
          onTokenReceived(token.value);
        },
      );

      const h2 = await PushNotifications.addListener(
        "registrationError",
        (err: any) => {},
      );

      const h3 = await PushNotifications.addListener(
        "pushNotificationReceived",
        (notification) => {
          onNotificationReceived(notification);
        },
      );

      const h4 = await PushNotifications.addListener(
        "pushNotificationActionPerformed",
        (action: ActionPerformed) => {
          if (action.notification.data?.deepLink) {
            this.parseAndBroadcastLink(action.notification.data.deepLink);
          }
        },
      );

      return () => {
        h1.remove();
        h2.remove();
        h3.remove();
        h4.remove();
      };
    } catch (err) {
      return () => {};
    }
  }

  private mapNotificationPermission(
    receive: PushPermissionStatus["receive"],
  ): "granted" | "denied" | "prompt" {
    if (receive === "granted") return "granted";
    if (receive === "denied") return "denied";
    return "prompt";
  }

  public async clearAllDeliveredNotifications(): Promise<void> {
    if (this.isNative) {
      try {
        await PushNotifications.removeAllDeliveredNotifications();
      } catch (err) {}
    }
  }

  public async setBadgeCount(count: number): Promise<void> {
    if (this.isNative) {
      // Reserved for future native badge support.
    }
  }

  public isOnline(): boolean {
    return this.currentOnlineStatus;
  }

  public onNetworkChange(callback: (isOnline: boolean) => void): () => void {
    this.onlineStatusListeners.add(callback);
    callback(this.currentOnlineStatus);
    return () => {
      this.onlineStatusListeners.delete(callback);
    };
  }

  private initializeWebNetworkListeners(): void {
    if (typeof window === "undefined") return;

    if (this.isNative) {
      Network.addListener("networkStatusChange", (status) => {
        this.currentOnlineStatus = status.connected;
        this.onlineStatusListeners.forEach((cb) => cb(status.connected));
      });

      Network.getStatus()
        .then((status) => {
          this.currentOnlineStatus = status.connected;
          this.onlineStatusListeners.forEach((cb) => cb(status.connected));
        })
        .catch(() => {});
    } else {
      window.addEventListener("online", () => {
        this.currentOnlineStatus = true;
        this.onlineStatusListeners.forEach((cb) => cb(true));
      });

      window.addEventListener("offline", () => {
        this.currentOnlineStatus = false;
        this.onlineStatusListeners.forEach((cb) => cb(false));
      });
    }
  }

  public async openUrl(
    url: string,
    target: string = "_blank",
  ): Promise<void> {
    const safeUrl = this.sanitizeExternalUrl(url);
    if (!safeUrl) return;

    if (this.isNative) {
      try {
        await Browser.open({
          url: safeUrl,
          presentationStyle: "popover",
        });
      } catch (err) {
        window.open(safeUrl, "_blank");
      }
    } else {
      window.open(safeUrl, target);
    }
  }

  /**
   * Open a YouTube link in the installed native YouTube app.
   *
   * IMPORTANT:
   * - Native iOS does NOT use Browser.open() here.
   * - Native iOS does NOT use the custom CapExternalOpener plugin here.
   * - The official Capacitor AppLauncher plugin opens the youtube:// scheme.
   * - If YouTube is not available, this method throws instead of silently
   *   falling back to Safari. The caller can surface an error to the user.
   */
  public async openYouTubeUrl(url: string): Promise<void> {
    const safeUrl = this.sanitizeExternalUrl(url);

    if (!safeUrl) {
      const error = new Error("invalid_youtube_url");
      console.error("[YT BRIDGE] URL rejected by sanitizer:", url);
      throw error;
    }

    // Web/PWA keeps normal browser behavior.
    if (!this.isNative) {
      window.open(safeUrl, "_blank", "noopener,noreferrer");
      return;
    }

    // This native implementation is intentionally scoped to iOS.
    if (Capacitor.getPlatform() !== "ios") {
      await Browser.open({ url: safeUrl });
      return;
    }

    const videoId = this.extractYouTubeVideoId(safeUrl);

    if (!videoId) {
      console.error("[YT BRIDGE] Could not extract YouTube video ID:", safeUrl);
      throw new Error("invalid_youtube_video_id");
    }

    const nativeUrl = `youtube://watch?v=${encodeURIComponent(videoId)}`;

    console.log("[YT BRIDGE] Native YouTube request:", {
      safeUrl,
      videoId,
      nativeUrl,
      platform: Capacitor.getPlatform(),
    });

    let canOpen: { value: boolean };

    try {
      canOpen = await AppLauncher.canOpenUrl({ url: nativeUrl });
    } catch (error) {
      console.error("[YT BRIDGE] AppLauncher.canOpenUrl FAILED:", error);
      throw new Error("youtube_can_open_check_failed", { cause: error });
    }

    console.log("[YT BRIDGE] AppLauncher.canOpenUrl result:", canOpen);

    if (!canOpen.value) {
      // Deliberately do NOT open Safari here. This prevents a broken native
      // integration from being disguised as a successful browser fallback.
      console.error(
        "[YT BRIDGE] Native YouTube app is unavailable or youtube scheme cannot be queried.",
      );
      throw new Error("youtube_app_not_available");
    }

    try {
      await AppLauncher.openUrl({ url: nativeUrl });
      console.log("[YT BRIDGE] AppLauncher.openUrl dispatched successfully");
    } catch (error) {
      console.error("[YT BRIDGE] AppLauncher.openUrl FAILED:", error);
      throw new Error("youtube_native_open_failed", { cause: error });
    }
  }

  public async openPdfUrl(url: string, webWindow?: Window | null): Promise<void> {
    console.log("[PDF-FINAL] openPdfUrl input received");

    const safeUrl = this.sanitizeExternalUrl(url);
    if (!safeUrl) {
      console.error("[PDF-FINAL] URL REJECTED by sanitizer", {
        rawUrl: url,
      });
      throw new Error("pdf_url_rejected");
    }

    let parsed: URL;
    try {
      parsed = new URL(safeUrl);
    } catch {
      if (webWindow) webWindow.close();
      throw new Error("pdf_url_rejected");
    }

    console.log("[PDF-FINAL] sanitized PDF URL", {
      host: parsed.host,
      path: parsed.pathname,
      hasDownloadToken: Boolean(parsed.searchParams.get("download_token")),
      isNative: this.isNative,
    });

    if (this.isNative) {
      // iOS/Android browser PDF renderers can start painting the first page while
      // the network stream is still arriving. Prefer that path for every
      // authorized PDF URL instead of waiting for the native plugin to download
      // the entire file before presenting anything. The native downloader stays
      // as a compatibility fallback if the streaming viewer cannot open.
      try {
        await Browser.open({ url: safeUrl, presentationStyle: "fullscreen" });
        console.log("[PDF-FAST] streaming PDF viewer opened");
        return;
      } catch (streamingError) {
        console.warn(
          "[PDF-FAST] streaming viewer failed; falling back to native preview",
          streamingError,
        );
      }

      try {
        await CapExternalOpener.openPdf({ url: safeUrl });
        console.log("[PDF-FINAL] CapExternalOpener.openPdf fallback succeeded");
        return;
      } catch (error) {
        console.error("[PDF-FINAL] CapExternalOpener.openPdf fallback FAILED", error);
        if (webWindow) webWindow.close();
        throw new Error("pdf_native_open_failed", { cause: error });
      }
    }

    if (webWindow) {
      webWindow.location.href = safeUrl;
      return;
    }
    const opened = window.open(safeUrl, "_blank", "noopener,noreferrer");
    if (!opened) {
      // Fallback to navigating the current window if popup is blocked
      window.location.href = safeUrl;
    }
  }

  public async closeExternalBrowser(): Promise<void> {
    if (!this.isNative) return;
    try {
      await Browser.close();
    } catch (_) {}
  }

  // ── External URL guard ──────────────────────────────────────────────────────

  private static readonly APPROVED_EXTERNAL_HOSTS = new Set([
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
    "youtube-nocookie.com",
  ]);

  /**
   * Extract the canonical 11-character YouTube video ID from supported links.
   */
  private extractYouTubeVideoId(rawUrl: string): string | null {
    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.toLowerCase();

      let candidate: string | null = null;

      if (host === "youtu.be") {
        candidate = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
      } else if (
        host === "youtube.com" ||
        host === "www.youtube.com" ||
        host === "m.youtube.com"
      ) {
        if (parsed.pathname === "/watch") {
          candidate = parsed.searchParams.get("v");
        } else if (parsed.pathname.startsWith("/shorts/")) {
          candidate =
            parsed.pathname.split("/").filter(Boolean)[1] ?? null;
        } else if (parsed.pathname.startsWith("/embed/")) {
          candidate =
            parsed.pathname.split("/").filter(Boolean)[1] ?? null;
        }
      }

      if (!candidate) return null;

      const normalized = candidate.trim();

      return /^[A-Za-z0-9_-]{11}$/.test(normalized)
        ? normalized
        : null;
    } catch {
      return null;
    }
  }

  private sanitizeExternalUrl(rawUrl: string): string | null {
    if (!rawUrl || typeof rawUrl !== "string") {
      console.error("[PDF-AUDIT] sanitizeExternalUrl rejected empty/non-string URL");
      return null;
    }

    let absolute: string;
    if (rawUrl.startsWith("/")) {
      const base = getApiBaseUrl() || window.location.origin;
      absolute = base + rawUrl;
    } else {
      absolute = rawUrl;
    }

    let parsed: URL;
    try {
      parsed = new URL(absolute);
    } catch {
      return null;
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }

    const host = parsed.hostname.toLowerCase();
    const isLocalHost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      /^(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(
        host,
      );

    if (parsed.protocol === "http:" && !isLocalHost) return null;

    let apiHost = "";
    try {
      apiHost = new URL(
        getApiBaseUrl() || window.location.origin,
      ).hostname.toLowerCase();
    } catch {
      /* unresolved base means no external API host */
    }

    const isAppOrigin =
      host === window.location.hostname ||
      (apiHost !== "" && host === apiHost);

    return parsed.href;
  }
}

export const NativeBridge = new NativeBridgeManager();
