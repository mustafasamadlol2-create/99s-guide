import { useEffect, useLayoutEffect } from "react";
import { usePersonalization } from "./PersonalizationProvider";
import { synchronizePersonalizationTheme } from "./personalizationTheme";

const useThemeEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The only runtime bridge between account personalization and the document.
 *
 * It reflects committed state only. Draft changes remain local to the
 * personalization editor until a successful transactional Apply.
 */
export function PersonalizationThemeBridge() {
  const { committed, hydration, userId } = usePersonalization();

  useThemeEffect(() => {
    if (typeof document === "undefined") return;
    // Keep the last committed visual state on screen while the same account's
    // local envelope is being read. Resetting the bridge to the Classic
    // default during this window causes an alternate theme to flash, then
    // appear to revert before hydration completes.
    if (hydration.phase === "loading") return;
    synchronizePersonalizationTheme(document.documentElement, committed.themeId);
  }, [committed.themeId, hydration.phase, userId]);

  return null;
}