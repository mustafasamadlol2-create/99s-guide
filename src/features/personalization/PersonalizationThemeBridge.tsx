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
  const { committed } = usePersonalization();

  useThemeEffect(() => {
    if (typeof document === "undefined") return;
    synchronizePersonalizationTheme(document.documentElement, committed.themeId);
  }, [committed.themeId]);

  return null;
}