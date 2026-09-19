import { useEffect, useLayoutEffect, useRef } from "react";
import { usePersonalization } from "./PersonalizationProvider";
import { shouldPreservePersonalizationDuringHydration } from "./personalizationDocumentLifecycle";
import { synchronizePersonalizationPresentation } from "./personalizationPresentation";

const usePresentationEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Runtime owner for committed Hero, Glass, Motion, and Reading presentation.
 * Draft values stay inside My 99 until the provider reports a successful Apply.
 */
export function PersonalizationPresentationBridge() {
  const { committed, hydration, userId } = usePersonalization();
  const appliedOwnerUserIdRef = useRef<string | null>(null);

  usePresentationEffect(() => {
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

    // A different account or logout must cross the safe default boundary
    // before a new account's Hero/Glass/Motion/Reading state is applied.
    synchronizePersonalizationPresentation(
      document.documentElement,
      hydration.phase === "loading" ? "classic" : committed.heroStyle,
      hydration.phase === "loading" ? "balanced" : committed.glassStyle,
      hydration.phase === "loading" ? "full" : committed.motionStyle,
      hydration.phase === "loading" ? "default" : committed.readingSize,
    );
    appliedOwnerUserIdRef.current = userId;
  }, [
    committed.heroStyle,
    committed.glassStyle,
    committed.motionStyle,
    committed.readingSize,
    hydration.phase,
    userId,
  ]);

  return null;
}