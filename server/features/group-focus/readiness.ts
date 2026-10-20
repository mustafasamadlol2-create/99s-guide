import {
  getActiveGroupFocusCapabilityKey,
  type GroupFocusCapabilityEnvironment,
} from "../../../shared/group-focus-capability/keyring.js";
import {
  parseGroupFocusReconciliationKeyring,
  type GroupFocusReconciliationEnvironment,
} from "../../../shared/group-focus-reconciliation/signing.js";

export type GroupFocusRuntimeEnvironment = GroupFocusCapabilityEnvironment
  & GroupFocusReconciliationEnvironment;

export type GroupFocusRuntimeReadiness = Readonly<{
  ready: boolean;
  capabilityReady: boolean;
  reconciliationReady: boolean;
}>;

/**
 * Group Focus must not be exposed merely because its feature flag is on.
 * A usable runtime requires both capability signing (browser -> Worker) and
 * reconciliation signing (Worker <-> canonical backend) to be configured.
 * This helper never returns secret material and is safe to use for readiness
 * gating / client-visible availability hints.
 */
export function getGroupFocusRuntimeReadiness(
  environment: GroupFocusRuntimeEnvironment = process.env,
): GroupFocusRuntimeReadiness {
  let capabilityReady = false;
  let reconciliationReady = false;

  try {
    getActiveGroupFocusCapabilityKey(environment);
    capabilityReady = true;
  } catch {
    capabilityReady = false;
  }

  try {
    const keyring = parseGroupFocusReconciliationKeyring(
      environment.GROUP_FOCUS_RECONCILIATION_KEYS_JSON,
    );
    const activeKid = environment.GROUP_FOCUS_RECONCILIATION_ACTIVE_KID;
    reconciliationReady = typeof activeKid === "string" && keyring.has(activeKid);
  } catch {
    reconciliationReady = false;
  }

  return {
    ready: capabilityReady && reconciliationReady,
    capabilityReady,
    reconciliationReady,
  };
}

export function isGroupFocusRuntimeReady(
  environment: GroupFocusRuntimeEnvironment = process.env,
): boolean {
  return getGroupFocusRuntimeReadiness(environment).ready;
}
