import { useEffect, useLayoutEffect, useRef } from "react";
import { usePersonalization } from "./PersonalizationProvider";
import { shouldPreservePersonalizationDuringHydration } from "./personalizationDocumentLifecycle";
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
  const appliedOwnerUserIdRef = useRef<string | null>(null);

  useThemeEffect(() => {
    if (typeof document === "undefined") return;
    if (
      shouldPreservePersonalizationDuringHydration(
        appliedOwnerUserIdRef.current,
        userId,
        hydration.phase,
      )
    ) {
      return;
    }

    // A different account or logout must cross the safe Classic boundary
    // before any new account cache is allowed to affect the document.
    synchronizePersonalizationTheme(
      document.documentElement,
      hydration.phase === "loading" ? "classic-99" : committed.themeId,
    );
    appliedOwnerUserIdRef.current = userId;
  }, [committed.themeId, hydration.phase, userId]);

  return null;
}