import { createHash } from "node:crypto";
import { canonicalJson } from "../study-core/canonicalJson.js";
import { GAMIFICATION_DEFINITION_CHECKSUM_NAMESPACE } from "./constants.js";
import { validateGamificationDefinitionBundle } from "./validation.js";
import type { GamificationDefinitionBundle } from "./types.js";

export function checksumGamificationDefinitionBundle(
  bundle: GamificationDefinitionBundle,
): string {
  validateGamificationDefinitionBundle(bundle);
  // Prompt 23 persisted this bundle with an empty Level definition array.
  // Keep that exact checksum payload while Level definitions receive a
  // separate checksum so existing rule-set rows and unlock proofs stay valid.
  const achievementBundle = { ...bundle, levelDefinitions: [] };
  return createHash("sha256")
    .update(GAMIFICATION_DEFINITION_CHECKSUM_NAMESPACE, "utf8")
    .update(canonicalJson(achievementBundle), "utf8")
    .digest("hex");
}