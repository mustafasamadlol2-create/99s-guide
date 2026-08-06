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
import { Network } from "@capacitor/network";

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
      // Android: extend WebView behind system bars (edge-to-edge).
      // setOverlaysWebView is Android-only; iOS ignores it safely.
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
    } catch (err) {
      
    }
  }

  /**
   * Monitor application active/background lifecycle changes (Apple HIG guidelines)
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
   * Register handler for the native hardware back button (Android/hybrid)
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
  // 2. Status Bar Control (HIG Theming)
  // ==========================================

  /**
   * Styles the iOS/Android status bar matching the active theme context
   */
  public async setStatusBarStyle(theme: "light" | "dark"): Promise<void> {
    if (!this.isNative) return;
    try {
      // Only set the icon/text style — do NOT call setBackgroundColor because
      // the status bar overlays the WebView (transparent), and a solid color
      // would re-opaque it and break edge-to-edge layout.
      await StatusBar.setStyle({
        style: theme === "dark" ? Style.Dark : Style.Light,
      });
    } catch (err) {
      
    }
  }

  /**
   * Show status bar
   */
  public async showStatusBar(): Promise<void> {
    if (!this.isNative) return;
    try {
      await StatusBar.show();
    } catch (err) {
      
    }
  }

  /**
   * Hide status bar for focus study, videos or fullscreen mode
   */
  public async hideStatusBar(): Promise<void> {
    if (!this.isNative) return;
    try {
      await StatusBar.hide();
    } catch (err) {
      
    }
  }

  // ==========================================
  // 3. Native Keyboard Behavior & Spacing Insets
  // ==========================================

  /**
   * Setup keyboard listeners to adapt views to avoid layout truncation
   */
  public listenToKeyboard(
    onUpdate: (state: KeyboardState) => void,
  ): () => void {
    this.keyboardListeners.add(onUpdate);

    if (!this.isNative) {
      // In web browser, simulate basic focus state detection on inputs
      const handleFocusIn = (e: FocusEvent) => {
        const target = e.target as HTMLElement;
        if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) {
          onUpdate({ isOpen: true, keyboardHeight: 280 }); // rough estimation for styling
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

  /**
   * Hide native virtual keyboard explicitly
   */
  public async hideKeyboard(): Promise<void> {
    try {
      if (this.isNative) {
        await Keyboard.hide();
      } else {
        const activeNode = document.activeElement as HTMLElement;
        if (activeNode) activeNode.blur();
      }
    } catch (err) {
      
    }
  }

  // ==========================================
  // 4. Deep Links / Universal Link Integrations
  // ==========================================

  /**
   * Register system-wide link handler
   */
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

        // Check for cold boot URL
        CapacitorApp.getLaunchUrl().then((launchData) => {
          if (launchData?.url) {
            this.parseAndBroadcastLink(launchData.url);
          }
        });

        return () => {
          this.deepLinkListeners.delete(listener);
          appUrlPromise.then((h) => h.remove());
        };
      } catch (err) {
        
      }
    }

    return () => {
      this.deepLinkListeners.delete(listener);
    };
  }

  private parseAndBroadcastLink(urlString: string): void {
    try {
      // Remove deep link schemes (e.g., "baghdadmedical://path?param=1" or standard universal links)
      let parsedUrl: URL;
      if (urlString.startsWith("http://") || urlString.startsWith("https://")) {
        parsedUrl = new URL(urlString);
      } else {
        // Mock schema conversion to satisfy standard URL constraints
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
        } catch (e) {
          
        }
      });
    } catch (err) {
      
    }
  }

  // ==========================================

  private pushChannelCreated: boolean = false;

  /**
   * Set up Push Notifications listening structures
   */
  public async setupPushNotifications(
    onTokenReceived: (token: string) => void,
    onNotificationReceived: (notification: any) => void,
  ): Promise<() => void> {
    if (!this.isNative) {
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

      // Create Android Notification Channel
      if (!this.pushChannelCreated) {
        try {
          await PushNotifications.createChannel({
            id: "default",
            name: "General Notifications",
            description: "Important updates and announcements",
            importance: 5, // HIGHEST importance for alerts
            visibility: 1, // PUBLIC
          });
          this.pushChannelCreated = true;
        } catch (err) {
          // Channel creation might fail on iOS, ignore safely
        }
      }

      // Register device with APNS/FCM Gateway
      await PushNotifications.register();

      // Set up callbacks
      const h1 = await PushNotifications.addListener("registration", (token: Token) => {
        onTokenReceived(token.value);
      });

      const h2 = await PushNotifications.addListener("registrationError", (err: any) => {
      });

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
      // Capacitor v6+ push notifications doesn't have setBadgeCount natively in the PushNotifications plugin
      // Wait, let's just attempt it if supported or leave it out if we don't need badge count
    }
  }

  /**
   * Check fallback network mode
   */
  public isOnline(): boolean {
    if (typeof navigator !== "undefined") {
      return navigator.onLine;
    }
    return true;
  }

  /**
   * Register listeners for offline network switches
   */
  public onNetworkChange(callback: (isOnline: boolean) => void): () => void {
    this.onlineStatusListeners.add(callback);
    return () => {
      this.onlineStatusListeners.delete(callback);
    };
  }

  private initializeWebNetworkListeners(): void {
    if (typeof window === "undefined") return;

    if (this.isNative) {
      // On native (iOS/Android) use the Capacitor Network plugin — window online/offline
      // events are unreliable inside WKWebView and do not fire for cellular/Wi-Fi switches.
      Network.addListener("networkStatusChange", (status) => {
        this.onlineStatusListeners.forEach((cb) => cb(status.connected));
      });

      // Seed initial state from the plugin so first render is accurate.
      Network.getStatus().then((status) => {
        this.onlineStatusListeners.forEach((cb) => cb(status.connected));
      }).catch(() => {});
    } else {
      // On web, browser online/offline events are sufficient.
      window.addEventListener("online", () => {
        this.onlineStatusListeners.forEach((cb) => cb(true));
      });

      window.addEventListener("offline", () => {
        this.onlineStatusListeners.forEach((cb) => cb(false));
      });
    }
  }

  public async openUrl(url: string, target: string = "_blank"): Promise<void> {
    if (this.isNative) {
      try {
        await Browser.open({ url, presentationStyle: 'popover' });
      } catch (err) {
        
        window.open(url, "_blank");
      }
    } else {
      window.open(url, target);
    }
  }
}

export const NativeBridge = new NativeBridgeManager();
