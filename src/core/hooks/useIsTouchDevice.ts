import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, Suspense, memo, lazy } from "react";

/**
 * Reusable utility hook detecting if the client device utilizes touch gestures (iOS, iPadOS, Android)
 * versus traditional mouse+keyboard hover interactions (macOS, Windows).
 */
export function useIsTouchDevice() {
  const [isTouch, setIsTouch] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const checkTouch = () => {
      return (
        "ontouchstart" in window ||
        navigator.maxTouchPoints > 0 ||
        // @ts-ignore
        (navigator.msMaxTouchPoints && navigator.msMaxTouchPoints > 0) ||
        window.matchMedia("(pointer: coarse)").matches
      );
    };

    setIsTouch(checkTouch());

    // In case the pointer/touch system changes dynamically (e.g. tablet docking, devtools toggles)
    const mediaQuery = window.matchMedia("(pointer: coarse)");
    const listener = (e: MediaQueryListEvent) => {
      setIsTouch(e.matches || checkTouch());
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", listener);
    } else {
      mediaQuery.addListener(listener);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", listener);
      } else {
        mediaQuery.removeListener(listener);
      }
    };
  }, []);

  return isTouch;
}
