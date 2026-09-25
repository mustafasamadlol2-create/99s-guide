import { createHash } from "node:crypto";
import { canonicalJson } from "../study-core/canonicalJson.js";
import { GAMIFICATION_DEFINITION_CHECKSUM_NAMESPACE } from "./constants.js";
import { validateGamificationDefinitionBundle } from "./validation.js";
import type { GamificationDefinitionBundle } from "./types.js";

export function checksumGamificationDefinitionBundle(
  bundle: GamificationDefinitionBundle,
): string {
  validateGamificationDefinitionBundle(bundle);
  return createHash("sha256")
    .update(GAMIFICATION_DEFINITION_CHECKSUM_NAMESPACE, "utf8")
    .update(canonicalJson(bundle), "utf8")
    .digest("hex");
}