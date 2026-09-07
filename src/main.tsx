/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Capacitor } from "@capacitor/core";
import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";

import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LaunchScreen } from "./components/ui/LaunchScreen";
import "./index.css";
import { HapticFeedback } from "./core/device/haptic";
import { isAppleTouchNavigationDevice } from "./core/hooks/useSwipeBack";

// Note: dark/light class and pre-paint background are applied by the inline
// script in index.html before any JS loads — no duplicate needed here.

// Polyfill localStorage for restrictive iframe security contexts.
try {
  localStorage.getItem("test_storage");
} catch (e) {
  const memStorage = new Map<string, string>();

  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: (k: string) => memStorage.get(k) || null,
      setItem: (k: string, v: string) =>
        memStorage.set(k, String(v)),
      removeItem: (k: string) => memStorage.delete(k),
      clear: () => memStorage.clear(),
      key: (i: number) =>
        Array.from(memStorage.keys())[i] || null,
      get length() {
        return memStorage.size;
      },
    },
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

// ============================================================================
// Centralized Haptic Interceptor
// ============================================================================
//
// IMPORTANT:
// Haptics must run only AFTER a completed user activation.
//
// Previously this listener used "pointerdown". On touch devices that meant a
// native Capacitor haptic call was dispatched while iOS was still deciding
// whether the gesture was a tap, scroll, drag, or cancelled touch.
//
// We intentionally use "click" instead.
//
// Results:
//
// intentional tap
//   -> click
//   -> haptic
//   -> control action
//
// scroll / drag / cancelled touch
//   -> no click
//   -> no haptic
//
// This also keeps native document buttons free from native bridge activity
// during their pointer/touch recognition phase.
// ============================================================================

let lastHapticTime = 0;

document.addEventListener(
  "click",
  (event) => {
    const now = Date.now();

    // Prevent accidental duplicate haptics from very rapid duplicate events.
    if (now - lastHapticTime < 50) {
      return;
    }

    let target =
      event.target instanceof HTMLElement
        ? event.target
        : null;

    while (
      target &&
      target !== document.body
    ) {
      const tagName =
        target.tagName.toLowerCase();

      const role =
        target.getAttribute("role");

      const isClickable =
        tagName === "button" ||
        tagName === "a" ||
        role === "button" ||
        role === "tab" ||
        role === "switch" ||
        role === "menuitem" ||
        target.classList.contains(
          "cursor-pointer",
        );

      if (isClickable) {
        // Explicit opt-out.
        if (
          target.getAttribute(
            "data-haptic",
          ) === "none"
        ) {
          break;
        }

        // Disabled controls should never produce haptic feedback.
        if (
          target.hasAttribute("disabled") ||
          target.getAttribute(
            "aria-disabled",
          ) === "true"
        ) {
          break;
        }

        let defaultType = "light";

        if (
          role === "tab" ||
          role === "menuitem" ||
          role === "switch"
        ) {
          defaultType = "selection";
        } else if (
          target.closest("nav") ||
          target.closest(
            ".liquid-glass-tabbar",
          )
        ) {
          defaultType = "selection";
        }

        const type =
          target.getAttribute(
            "data-haptic",
          ) || defaultType;

        /*
         * Fire-and-forget.
         *
         * Never await haptics inside the DOM event path.
         */
        try {
          if (type === "selection") {
            void HapticFeedback.selection();
          } else if (type === "medium") {
            void HapticFeedback.impact(
              "medium",
            );
          } else if (type === "heavy") {
            void HapticFeedback.impact(
              "heavy",
            );
          } else if (type === "success") {
            void HapticFeedback.notification(
              "success",
            );
          } else if (type === "warning") {
            void HapticFeedback.notification(
              "warning",
            );
          } else if (type === "error") {
            void HapticFeedback.notification(
              "error",
            );
          } else {
            void HapticFeedback.impact(
              "light",
            );
          }
        } catch (err) {
          console.error(
            "haptic FAILED:",
            err,
          );
        }

        lastHapticTime = now;
        break;
      }

      target =
        target.parentElement;
    }
  },
  {
    /*
     * No preventDefault is used here.
     *
     * Keeping the listener passive ensures this global feedback layer can
     * never cancel browser/iOS click behavior.
     */
    passive: true,
  },
);


// ============================================================================
// iOS / iPadOS delayed touch-down feedback
// ============================================================================
// UIKit delays row/button highlighting very slightly while it decides whether a
// finger intends to tap or scroll. Reproducing that behavior avoids the web-like
// instant flash on touchStart while still giving intentional taps a crisp press
// state. This layer changes opacity only; it never changes layout/transform and
// never runs on mouse/trackpad input.

const TOUCH_FEEDBACK_SELECTOR = [
  "button:not(:disabled)",
  "a[href]",
  '[role="button"]:not([aria-disabled="true"])',
  '[role="tab"]:not([aria-disabled="true"])',
  '[role="switch"]:not([aria-disabled="true"])',
  '[role="menuitem"]:not([aria-disabled="true"])',
  ".cursor-pointer",
].join(",");

const TOUCH_FEEDBACK_EXCLUDED_SELECTOR = [
  '#ios_native_tabbar_wrapper',
  '.document-open-button',
  '[data-touch-feedback="none"]',
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
].join(",");

if (isAppleTouchNavigationDevice()) {
  let candidate: HTMLElement | null = null;
  let startX = 0;
  let startY = 0;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;

  const clearPressTimer = () => {
    if (pressTimer !== null) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };

  const clearPressedState = (tail = false) => {
    clearPressTimer();
    const node = candidate;
    candidate = null;
    if (!node) return;

    const remove = () => node.removeAttribute("data-ios-touch-pressed");
    if (tail && node.hasAttribute("data-ios-touch-pressed")) {
      setTimeout(remove, 70);
    } else {
      remove();
    }
  };

  document.addEventListener(
    "touchstart",
    (event) => {
      clearPressedState(false);
      if (event.touches.length !== 1) return;

      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest(TOUCH_FEEDBACK_EXCLUDED_SELECTOR)) return;
      const interactive = target.closest<HTMLElement>(TOUCH_FEEDBACK_SELECTOR);
      if (!interactive) return;
      if (interactive.closest(TOUCH_FEEDBACK_EXCLUDED_SELECTOR)) return;

      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      candidate = interactive;

      pressTimer = setTimeout(() => {
        pressTimer = null;
        candidate?.setAttribute("data-ios-touch-pressed", "true");
      }, 45);
    },
    { passive: true, capture: true },
  );

  document.addEventListener(
    "touchmove",
    (event) => {
      if (!candidate || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.hypot(dx, dy) > 9) clearPressedState(false);
    },
    { passive: true, capture: true },
  );

  document.addEventListener(
    "touchend",
    () => clearPressedState(true),
    { passive: true, capture: true },
  );

  document.addEventListener(
    "touchcancel",
    () => clearPressedState(false),
    { passive: true, capture: true },
  );
}

// ============================================================================
// Service Worker registration — Web only
// ============================================================================

const registerServiceWorker = () => {
  if (
    Capacitor.isNativePlatform()
  ) {
    return;
  }

  if ("serviceWorker" in navigator) {
    if (
      (
        import.meta as ImportMeta & {
          env?: {
            MODE?: string;
          };
        }
      ).env?.MODE === "production"
    ) {
      window.addEventListener(
        "load",
        () => {
          navigator.serviceWorker
            .register("/sw.js")
            .then(
              (registration) => {
                // Listen for updates to the service worker code.
                registration.addEventListener(
                  "updatefound",
                  () => {
                    const newWorker =
                      registration.installing;

                    if (newWorker) {
                      newWorker.addEventListener(
                        "statechange",
                        () => {
                          if (
                            newWorker.state ===
                            "installed"
                          ) {
                            if (
                              navigator
                                .serviceWorker
                                .controller
                            ) {
                              // Activate updated web assets immediately.
                              newWorker.postMessage(
                                {
                                  type: "SKIP_WAITING",
                                },
                              );
                            }
                          }
                        },
                      );
                    }
                  },
                );
              },
            )
            .catch(() => {});
        },
      );

      // Handle seamless refresh when the new active service worker
      // takes control.
      //
      // The refreshing guard prevents an infinite reload loop.
      let refreshing = false;

      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          if (!refreshing) {
            refreshing = true;
            window.location.reload();
          }
        },
      );
    } else {
      // Remove stale workers during development so they cannot
      // serve old bundles.
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          for (
            const registration of
            registrations
          ) {
            registration.unregister();
          }
        });
    }
  }
};

registerServiceWorker();

// ============================================================================
// Root wrapper — manages launch screen lifecycle
// ============================================================================

function Root() {
  const [showLaunch, setShowLaunch] =
    useState(true);

  return (
    <ErrorBoundary>
      <>
        {showLaunch && (
          <LaunchScreen
            onDone={() =>
              setShowLaunch(false)
            }
          />
        )}

        <App />

        <Toaster
          position="bottom-center"
          richColors
          expand={false}
          closeButton
          toastOptions={{
            duration: 5000,
            classNames: {
              toast:
                "font-sans text-sm shadow-xl rounded-xl border backdrop-blur-sm",
              title:
                "font-semibold",
              description:
                "font-normal opacity-80",
              closeButton:
                "rounded-lg border border-neutral-200 dark:border-white/10",
            },
          }}
        />
      </>
    </ErrorBoundary>
  );
}

createRoot(
  document.getElementById("root")!,
).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);