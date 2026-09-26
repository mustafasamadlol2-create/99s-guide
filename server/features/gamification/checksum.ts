import { createHash } from "node:crypto";
import { canonicalJson } from "../study-core/canonicalJson.js";
import { GAMIFICATION_DEFINITION_CHECKSUM_NAMESPACE } from "./constants.js";
import { validateGamificationDefinitionBundle } from "./validation.js";
import type { GamificationDefinitionBundle } from "./types.js";

export function checksumGamificationDefinitionBundle(
  bundle: GamificationDefinitionBundle,
): string {
  validateGamificationDefinitionBundle(bundle);
  // Prompt 23/24 persisted this bundle with empty Level and Challenge arrays.
  // Keep that payload stable while those versioned definitions use separate
  // checksums, so existing rule-set rows and unlock proofs remain valid.
  const achievementBundle = {
    ...bundle,
    levelDefinitions: [],
    challengeDefinitionContracts: [],
  };
  return createHash("sha256")
    .update(GAMIFICATION_DEFINITION_CHECKSUM_NAMESPACE, "utf8")
    .update(canonicalJson(achievementBundle), "utf8")
    .digest("hex");
}