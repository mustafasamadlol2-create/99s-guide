import type { IntegrityObservation } from "./types.js";
import { createIntegrityObservation } from "./observations.js";

/**
 * The product service owns the lookup and passes only its normalized result.
 * Integrity does not query resource, session, lecture, or room tables.
 */
export function ownershipObservation(
  ownershipValid: boolean,
  details: Readonly<Record<string, unknown>> = {},
): IntegrityObservation | undefined {
  return ownershipValid
    ? undefined
    : createIntegrityObservation("OWNERSHIP_MISMATCH", details);
}

export function resourceScopeObservation(
  resourceScopeValid: boolean,
  details: Readonly<Record<string, unknown>> = {},
): IntegrityObservation | undefined {
  return resourceScopeValid
    ? undefined
    : createIntegrityObservation("RESOURCE_SCOPE_MISMATCH", details);
}

export function validateTransition(input: {
  from: string;
  to: string;
  allowedTransitions: Readonly<Record<string, readonly string[]>>;
}): { valid: boolean; observation?: IntegrityObservation } {
  const allowed = input.allowedTransitions[input.from] ?? [];
  if (allowed.includes(input.to)) return { valid: true };
  return {
    valid: false,
    observation: createIntegrityObservation("INVALID_STATE_TRANSITION", {
      from: input.from,
      to: input.to,
    }),
  };
}