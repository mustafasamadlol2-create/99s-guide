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
  const { committed } = usePersonalization();

  usePresentationEffect(() => {
    if (typeof document === "undefined") return;
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
  ]);

  return null;
}