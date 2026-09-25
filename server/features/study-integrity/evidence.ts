import {
  EVIDENCE_CLASSES,
  getEvidenceRank,
  type EvidenceClass,
} from "../study-core/evidence.js";
import type { StudyEventSource } from "../study-core/events.js";
import type {
  IntegrityDecision,
  IntegrityPolicy,
  IntegrityRewardEligibility,
} from "./types.js";
import { createIntegrityObservation } from "./observations.js";
import { getIntegrityPolicy } from "./policy.js";

const SERVER_EVIDENCE_CLASSES: readonly EvidenceClass[] = [
  "SERVER_VALIDATED",
  "SERVER_DERIVED",
  "REALTIME_VERIFIED",
  "ADMIN_VERIFIED",
];

export function isEvidenceClass(value: unknown): value is EvidenceClass {
  return EVIDENCE_CLASSES.some((candidate) => candidate === value);
}

export function meetsEvidenceRequirement(
  actual: EvidenceClass,
  minimum: EvidenceClass,
): boolean {
  return getEvidenceRank(actual) >= getEvidenceRank(minimum);
}

export function meetsIntegrityEvidencePolicy(
  actual: EvidenceClass,
  policy: Pick<IntegrityPolicy, "minimumEvidence" | "requiredEvidenceClass">,
): boolean {
  if (
    policy.requiredEvidenceClass !== undefined &&
    actual !== policy.requiredEvidenceClass
  ) {
    return false;
  }
  return meetsEvidenceRequirement(actual, policy.minimumEvidence);
}

export function isServerOwnedEvidence(evidenceClass: EvidenceClass): boolean {
  return SERVER_EVIDENCE_CLASSES.includes(evidenceClass);
}

export function validateSourceEvidencePair(input: {
  source: StudyEventSource;
  evidenceClass: EvidenceClass;
  policy: Pick<
    IntegrityPolicy,
    | "minimumEvidence"
    | "requiredEvidenceClass"
    | "allowedSources"
    | "serverOwnedSources"
  >;
}): {
  valid: boolean;
  observations: ReturnType<typeof createIntegrityObservation>[];
} {
  const observations: ReturnType<typeof createIntegrityObservation>[] = [];
  const sourceAllowed = input.policy.allowedSources.includes(input.source);
  const serverSourceAllowed =
    !isServerOwnedEvidence(input.evidenceClass) ||
    input.policy.serverOwnedSources.includes(input.source);

  if (!sourceAllowed || !serverSourceAllowed) {
    observations.push(
      createIntegrityObservation("SOURCE_NOT_ALLOWED", {
        source: input.source,
        evidenceClass: input.evidenceClass,
      }),
    );
  }

  if (!meetsIntegrityEvidencePolicy(input.evidenceClass, input.policy)) {
    observations.push(
      createIntegrityObservation("EVIDENCE_INSUFFICIENT", {
        actualEvidence: input.evidenceClass,
        minimumEvidence: input.policy.minimumEvidence,
        requiredEvidence: input.policy.requiredEvidenceClass ?? null,
      }),
    );
  }

  return { valid: observations.length === 0, observations };
}

export function isEvidenceEligibleForReward(input: {
  actionType: string;
  source: StudyEventSource;
  decision: Pick<
    IntegrityDecision,
    "outcome" | "effectiveEvidenceClass"
  >;
}): IntegrityRewardEligibility {
  const policy = getIntegrityPolicy(input.actionType);
  if (!policy) return { eligible: false, reason: "POLICY_NOT_FOUND" };
  if (input.decision.outcome !== "ALLOW") {
    return { eligible: false, reason: "DECISION_NOT_ALLOW" };
  }
  if (
    !policy.rewardEligibleEvidence.includes(
      input.decision.effectiveEvidenceClass,
    ) ||
    !validateSourceEvidencePair({
      source: input.source,
      evidenceClass: input.decision.effectiveEvidenceClass,
      policy,
    }).valid
  ) {
    return { eligible: false, reason: "EVIDENCE_NOT_ELIGIBLE" };
  }
  return { eligible: true, reason: "ELIGIBLE" };
}