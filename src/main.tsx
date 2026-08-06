import { Capacitor } from "@capacitor/core";
import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";

import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LaunchScreen } from "./components/ui/LaunchScreen";
import "./index.css";
import { HapticFeedback } from "./core/device/haptic";

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
      setItem: (k: string, v: string) => memStorage.set(k, String(v)),
      removeItem: (k: string) => memStorage.delete(k),
      clear: () => memStorage.clear(),
      key: (i: number) => Array.from(memStorage.keys())[i] || null,
      get length() {
        return memStorage.size;
      },
    },
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

// Centralized Haptic Interceptor
let lastHapticTime = 0;
document.addEventListener(
  "pointerdown",
  (e) => {
    const now = Date.now();
    // Throttle haptics slightly to prevent multi-touch spam
    if (now - lastHapticTime < 50) return;

    let target = e.target as HTMLElement | null;
    while (target && target !== document.body) {
      const tagName = target.tagName.toLowerCase();
      const role = target.getAttribute("role");
      const isClickable =
        tagName === "button" ||
        tagName === "a" ||
        role === "button" ||
        role === "tab" ||
        role === "switch" ||
        role === "menuitem" ||
        target.classList.contains("cursor-pointer");

      if (isClickable) {
        // Don't intercept if it's explicitly disabled
        if (target.getAttribute("data-haptic") === "none") {
          break;
        }

        let defaultType = "light";
        if (role === "tab" || role === "menuitem" || role === "switch") {
          defaultType = "selection";
        } else if (
          target.closest("nav") ||
          target.closest(".liquid-glass-tabbar")
        ) {
          defaultType = "selection";
        }

        const type = target.getAttribute("data-haptic") || defaultType;
        if (type === "selection") HapticFeedback.selection();
        else if (type === "medium") HapticFeedback.impact("medium");
        else if (type === "heavy") HapticFeedback.impact("heavy");
        else if (type === "success") HapticFeedback.notification("success");
        else if (type === "warning") HapticFeedback.notification("warning");
        else if (type === "error") HapticFeedback.notification("error");
        else HapticFeedback.impact("light");

        lastHapticTime = now;
        break;
      }
      target = target.parentElement;
    }
  },
  { passive: true },
);








// --- Service Worker registration for web only ---
const registerServiceWorker = () => {
  if (Capacitor.isNativePlatform()) {
    
    return;
  }

  if ("serviceWorker" in navigator) {
    if ((import.meta as any).env.MODE === "production") {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("/sw.js")
          .then((registration) => {
            // Listen for updates to the service worker code
            registration.addEventListener("updatefound", () => {
              const newWorker = registration.installing;
              if (newWorker) {
                newWorker.addEventListener("statechange", () => {
                  if (newWorker.state === "installed") {
                    if (navigator.serviceWorker.controller) {
                      // Activate updated web assets immediately.
                      newWorker.postMessage({ type: "SKIP_WAITING" });
                    }
                  }
                });
              }
            });
          })
          .catch(() => {});
      });

      // Handle seamless refresh when the new active service worker takes control
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!refreshing) {
          refreshing = true;
          // window.location.reload();
        }
      });
    } else {
      // Remove stale workers during development so they cannot serve old bundles.
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister();
        }
      });
    }
  }
};

registerServiceWorker();



// ─── Root wrapper — manages launch screen lifecycle ──────────────────────────
function Root() {
  const [showLaunch, setShowLaunch] = useState(true);
  return (
    <>
      {showLaunch && <LaunchScreen onDone={() => setShowLaunch(false)} />}
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
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
            title: "font-semibold",
            description: "font-normal opacity-80",
            closeButton:
              "rounded-lg border border-neutral-200 dark:border-white/10",
          },
        }}
      />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
