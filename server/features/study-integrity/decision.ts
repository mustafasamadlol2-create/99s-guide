import { STUDY_INTEGRITY_RULE_VERSION } from "./constants.js";
import { isEvidenceClass, validateSourceEvidencePair } from "./evidence.js";
import { StudyIntegrityError } from "./errors.js";
import { fingerprintsMatch } from "./fingerprint.js";
import { createIntegrityObservation } from "./observations.js";
import { getIntegrityPolicy } from "./policy.js";
import { evaluateRateWindow } from "./rateWindow.js";
import { assessIntegrityTimestamp, isValidIntegrityInstant, validateDurationSeconds } from "./timing.js";
import { ownershipObservation, resourceScopeObservation, validateTransition } from "./ownership.js";
import { validateIntegrityEnvelopeStructure } from "./validation.js";
import type {
  IntegrityActionEnvelope,
  IntegrityDecision,
  IntegrityDecisionContext,
  IntegrityObservation,
} from "./types.js";

function decision(input: {
  outcome: IntegrityDecision["outcome"];
  observations: IntegrityObservation[];
  effectiveEvidenceClass: IntegrityDecision["effectiveEvidenceClass"];
  trustedOccurredAt: Date;
}): IntegrityDecision {
  return {
    ...input,
    observations: input.observations,
    trustedOccurredAt: new Date(input.trustedOccurredAt.getTime()),
    ruleVersion: STUDY_INTEGRITY_RULE_VERSION,
  };
}

function outcomeFor(observations: readonly IntegrityObservation[]): IntegrityDecision["outcome"] {
  if (observations.some((observation) => observation.severity === "BLOCK")) {
    return "REJECT";
  }
  if (observations.some((observation) => observation.severity === "REVIEW")) {
    return "ALLOW_WITH_OBSERVATION";
  }
  return "ALLOW";
}

function blockDecision(input: {
  observation: IntegrityObservation;
  receivedAt: Date;
}): IntegrityDecision {
  return decision({
    outcome: "REJECT",
    observations: [input.observation],
    effectiveEvidenceClass: "UNVERIFIED_CLIENT",
    trustedOccurredAt: input.receivedAt,
  });
}

export function evaluateIntegrityAction(
  action: IntegrityActionEnvelope,
  context: IntegrityDecisionContext = {},
): IntegrityDecision {
  if (!isValidIntegrityInstant(action.receivedAt)) {
    throw new StudyIntegrityError(
      "INTEGRITY_INVALID_INPUT",
      "Server receivedAt must be a valid non-negative millisecond instant.",
    );
  }

  const policy = getIntegrityPolicy(action.actionType);
  if (!policy) {
    return blockDecision({
      observation: createIntegrityObservation("POLICY_NOT_FOUND", {
        actionType: action.actionType,
      }),
      receivedAt: action.receivedAt,
    });
  }

  const structural = validateIntegrityEnvelopeStructure(
    action,
    policy.payloadMaxBytes,
  );
  if (!structural.valid) {
    return decision({
      outcome: "REJECT",
      observations: structural.observations,
      effectiveEvidenceClass: "UNVERIFIED_CLIENT",
      trustedOccurredAt: action.receivedAt,
    });
  }

  const observations: IntegrityObservation[] = [];
  const sourceEvidence = validateSourceEvidencePair({
    source: action.source,
    evidenceClass: action.evidenceClass,
    policy,
  });
  observations.push(...sourceEvidence.observations);

  const privacyAllowed =
    action.privacyClass === policy.privacyClass &&
    policy.allowedPrivacyClasses.includes(action.privacyClass) &&
    action.privacyClass !== "PUBLIC" &&
    action.privacyClass !== "PROFILE_PUBLIC";
  if (!privacyAllowed) {
    observations.push(
      createIntegrityObservation("PRIVACY_CLASS_NOT_ALLOWED", {
        actionType: action.actionType,
        privacyClass: action.privacyClass,
      }),
    );
  }

  const timestamp = assessIntegrityTimestamp({
    occurredAt: action.occurredAt,
    receivedAt: action.receivedAt,
    policy: policy.timestampPolicy,
  });
  observations.push(...timestamp.observations);

  if (action.durationSeconds !== undefined) {
    const duration = validateDurationSeconds({
      durationSeconds: action.durationSeconds,
      bounds: policy.durationBounds,
    });
    if (duration.observation) observations.push(duration.observation);
  }

  if (context.transition) {
    const transition = validateTransition(context.transition);
    if (transition.observation) observations.push(transition.observation);
  }

  const ownership = context.ownershipValid === undefined
    ? undefined
    : ownershipObservation(context.ownershipValid);
  if (ownership) observations.push(ownership);

  const resourceScope =
    context.resourceScopeValid === undefined
      ? undefined
      : resourceScopeObservation(context.resourceScopeValid);
  if (resourceScope) observations.push(resourceScope);

  if (context.idempotency?.result === "CONFLICTING_PAYLOAD") {
    observations.push(
      createIntegrityObservation("IDEMPOTENCY_CONFLICT", {
        actionType: action.actionType,
      }),
    );
  } else if (context.idempotency?.result === "REPLAY_SAME_PAYLOAD") {
    const hasFingerprintPair =
      context.idempotency.existingFingerprint !== undefined &&
      context.idempotency.incomingFingerprint !== undefined;
    const fingerprintsAgree =
      !hasFingerprintPair ||
      fingerprintsMatch(
        context.idempotency.existingFingerprint!,
        context.idempotency.incomingFingerprint!,
      );
    observations.push(
      fingerprintsAgree
        ? createIntegrityObservation("DUPLICATE_REPLAY", {
            actionType: action.actionType,
          })
        : createIntegrityObservation("IDEMPOTENCY_CONFLICT", {
            actionType: action.actionType,
          }),
    );
  }

  if (policy.rateRule) {
    if (!context.priorActionTimestampsMs) {
      throw new StudyIntegrityError(
        "INTEGRITY_INVALID_INPUT",
        "A rate-rule policy requires explicit prior action timestamps.",
      );
    }
    const rate = evaluateRateWindow({
      nowMs: action.receivedAt.getTime(),
      previousActionTimestampsMs: context.priorActionTimestampsMs,
      rule: policy.rateRule,
    });
    if (!rate.allowed) {
      observations.push(
        createIntegrityObservation(
          "RATE_WINDOW_EXCEEDED",
          {
            count: rate.count,
            limit: rate.limit,
            burstAllowance: rate.burstAllowance,
            windowStartMs: rate.windowStartMs,
            windowEndMs: rate.windowEndMs,
            ruleId: policy.rateRule.ruleId,
          },
          policy.rateRule.exceededBehavior === "REJECT" ? "BLOCK" : "REVIEW",
        ),
      );
    }
  }

  const evidenceTrusted =
    sourceEvidence.valid &&
    isEvidenceClass(action.evidenceClass);
  return decision({
    outcome: outcomeFor(observations),
    observations,
    effectiveEvidenceClass: evidenceTrusted
      ? action.evidenceClass
      : "UNVERIFIED_CLIENT",
    trustedOccurredAt: timestamp.trustedOccurredAt,
  });
}
