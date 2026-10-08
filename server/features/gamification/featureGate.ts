import { isStudyFeatureEnabled } from "../study-core/featureFlags.js";
import { GamificationError } from "./errors.js";

export function isGamificationEnabled(): boolean {
  return isStudyFeatureEnabled("GAMIFICATION_ENABLED");
}

export function assertGamificationEnabled(): void {
  if (!isGamificationEnabled()) {
    throw new GamificationError(
      "FEATURE_DISABLED",
      "Gamification is disabled.",
    );
  }
}
