import { useEffect, useLayoutEffect } from "react";
import { usePersonalization } from "./PersonalizationProvider";
import { synchronizePersonalizationPresentation } from "./personalizationPresentation";

const usePresentationEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Runtime owner for committed Hero Style and Glass Style presentation.
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
    );
  }, [committed.heroStyle, committed.glassStyle]);

  return null;
}