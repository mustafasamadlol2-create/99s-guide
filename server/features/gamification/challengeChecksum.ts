import { createHash } from "node:crypto";
import { canonicalJson } from "../study-core/canonicalJson.js";
import {
  GAMIFICATION_CHALLENGE_DEFINITION_CHECKSUM_NAMESPACE,
} from "./constants.js";
import { GamificationError } from "./errors.js";
import { validateGamificationDefinitionBundle } from "./validation.js";
import type { GamificationDefinitionBundle } from "./types.js";

export function checksumGamificationChallengeDefinitions(
  bundle: GamificationDefinitionBundle,
): string {
  validateGamificationDefinitionBundle(bundle);
  return createHash("sha256")
    .update(GAMIFICATION_CHALLENGE_DEFINITION_CHECKSUM_NAMESPACE, "utf8")
    .update(canonicalJson({
      version: bundle.version,
      challengeDefinitionContracts: bundle.challengeDefinitionContracts,
    }), "utf8")
    .digest("hex");
}

export function assertGamificationChallengeDefinitionsChecksum(
  bundle: GamificationDefinitionBundle,
  expectedChecksum: string | null | undefined,
): string {
  const actual = checksumGamificationChallengeDefinitions(bundle);
  if (!expectedChecksum || actual !== expectedChecksum) {
    throw new GamificationError(
      "GAMIFICATION_CHALLENGE_DEFINITION_CHECKSUM_MISMATCH",
      `Challenge definitions for ${bundle.version} do not match their registered checksum.`,
    );
  }
  return actual;
}