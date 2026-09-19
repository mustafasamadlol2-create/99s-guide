import { useEffect, useLayoutEffect } from "react";
import { usePersonalization } from "./PersonalizationProvider";
import { synchronizePersonalizationPresentation } from "./personalizationPresentation";

const usePresentationEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Runtime owner for committed Hero, Glass, Motion, and Reading presentation.
 * Draft values stay inside My 99 until the provider reports a successful Apply.
 */
export function PersonalizationPresentationBridge() {
  const { committed, hydration, userId } = usePersonalization();

  usePresentationEffect(() => {
    if (typeof document === "undefined") return;
    // Preserve committed Hero/Glass presentation during local-cache hydration.
    // The next ready/fallback state is authoritative and synchronizes all
    // presentation attributes together.
    if (hydration.phase === "loading") return;
    synchronizePersonalizationPresentation(
      document.documentElement,
      committed.heroStyle,
      committed.glassStyle,
      committed.motionStyle,
      committed.readingSize,
    );
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