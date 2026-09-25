import { GamificationError } from "./errors.js";

export function isGamificationThresholdMet(
  value: number | boolean,
  threshold: number | boolean,
): boolean {
  if (typeof value === "boolean" || typeof threshold === "boolean") {
    if (typeof value !== "boolean" || threshold !== true) {
      throw new GamificationError(
        "GAMIFICATION_INVALID_INPUT",
        "Boolean metrics require a true threshold and a boolean value.",
      );
    }
    return value;
  }

  if (
    !Number.isSafeInteger(value)
    || !Number.isSafeInteger(threshold)
    || value < 0
    || threshold < 1
  ) {
    throw new GamificationError(
      "GAMIFICATION_INVALID_INPUT",
      "Numeric gamification thresholds require safe integers and a positive threshold.",
    );
  }
  return value >= threshold;
}