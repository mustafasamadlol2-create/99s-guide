import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

// Extend window interface for optional Capacitor check
declare global {
  interface Window {
    Capacitor?: any;
  }
}

/**
 * Tactical Touch feedback engine adhering to Apple HI guidelines.
 * Integrates Capacitor Haptics with progressive fallback to Web's Vibration API.
 */
export const HapticFeedback = {
  /**
   * Light, delicate tap. Use for selection changes, subtle wheel changes.
   */
  async selection() {
    try {
      if (window.Capacitor?.isPluginAvailable?.("Haptics")) {
        await Haptics.selectionStart();
        await Haptics.selectionChanged();
      } else if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(10);
      }
    } catch {
      // Sloped silent fail to maintain premium uninterrupted execution
    }
  },

  /**
   * Impact feedback for small physical collisions (button compressions, list item shifts)
   */
  async impact(style: "light" | "medium" | "heavy" = "light") {
    try {
      if (window.Capacitor?.isPluginAvailable?.("Haptics")) {
        const mappedStyle =
          style === "heavy"
            ? ImpactStyle.Heavy
            : style === "medium"
              ? ImpactStyle.Medium
              : ImpactStyle.Light;

        await Haptics.impact({ style: mappedStyle });
      } else if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        const ms = style === "heavy" ? 40 : style === "medium" ? 20 : 10;
        navigator.vibrate(ms);
      }
    } catch {
      // Sloped silent fail
    }
  },

  /**
   * Success, warning, and error events
   */
  async notification(type: "success" | "warning" | "error") {
    try {
      if (window.Capacitor?.isPluginAvailable?.("Haptics")) {
        const mappedType =
          type === "success"
            ? NotificationType.Success
            : type === "warning"
              ? NotificationType.Warning
              : NotificationType.Error;

        await Haptics.notification({ type: mappedType });
      } else if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        if (type === "success") {
          navigator.vibrate([15, 40, 15]);
        } else if (type === "warning") {
          navigator.vibrate([25, 60, 15]);
        } else {
          navigator.vibrate([40, 80, 40, 80]);
        }
      }
    } catch {
      // Sloped silent fail
    }
  },
};
