import type { IdempotencyResult } from "../study-core/idempotency.js";
import type { StudyEventSource } from "../study-core/events.js";
import type { EvidenceClass } from "../study-core/evidence.js";
import type { PrivacyClass } from "../study-core/privacy.js";
import type {
  IntegrityObservationCategory,
  IntegrityObservationCode,
  IntegrityObservationSeverity,
} from "./constants.js";

export type StudySource = StudyEventSource;

export type IntegrityStructuredValue =
  | null
  | boolean
  | number
  | string
  | readonly IntegrityStructuredValue[]
  | { readonly [key: string]: IntegrityStructuredValue };

export type IntegrityMetadata = Readonly<
  Record<string, IntegrityStructuredValue>
>;

export type IntegritySubject = {
  userId: string;
  source: StudySource;
  clientInstanceId?: string;
  sessionId?: string;
};

export type IntegrityResource = {
  kind: string;
  id: string;
};

export type IntegrityActionEnvelope = {
  actionType: string;
  userId: string;
  evidenceClass: EvidenceClass;
  privacyClass: PrivacyClass;
  source: StudySource;
  occurredAt: Date;
  receivedAt: Date;
  idempotencyKey?: string;
  clientInstanceId?: string;
  resource?: IntegrityResource;
  durationSeconds?: number;
  metadata?: IntegrityMetadata;
  payload?: IntegrityStructuredValue;
};

export type IntegrityTimestampPolicy = {
  authority: "CLIENT_BOUNDED" | "SERVER";
  acceptClientTimestamp: boolean;
  replaceWithServerTime: boolean;
  maxPastMs?: number;
  maxFutureMs?: number;
  clampSmallFutureSkew?: boolean;
};

export type IntegrityDurationBounds = {
  minSeconds?: number;
  maxSeconds?: number;
};

export type IntegrityRateRule = {
  ruleId: string;
  windowSeconds: number;
  maxActions: number;
  burstAllowance?: number;
  exceededBehavior: "ALLOW_WITH_OBSERVATION" | "REJECT";
};

export type IntegrityPolicy = {
  actionType: string;
  minimumEvidence: EvidenceClass;
  requiredEvidenceClass?: EvidenceClass;
  allowedSources: readonly StudySource[];
  serverOwnedSources: readonly StudySource[];
  privacyClass: PrivacyClass;
  allowedPrivacyClasses: readonly PrivacyClass[];
  timestampPolicy: IntegrityTimestampPolicy;
  durationBounds?: IntegrityDurationBounds;
  rateRule?: IntegrityRateRule;
  payloadMaxBytes: number;
  rewardEligibleEvidence: readonly EvidenceClass[];
};

export type IntegrityObservation = {
  code: IntegrityObservationCode;
  severity: IntegrityObservationSeverity;
  category: IntegrityObservationCategory;
  ruleId: string;
  details: Readonly<Record<string, IntegrityStructuredValue>>;
};

export type IntegrityDecisionOutcome =
  | "ALLOW"
  | "ALLOW_WITH_OBSERVATION"
  | "REJECT";

export type IntegrityDecision = {
  outcome: IntegrityDecisionOutcome;
  observations: readonly IntegrityObservation[];
  effectiveEvidenceClass: EvidenceClass;
  trustedOccurredAt: Date;
  ruleVersion: string;
};

export type IntegrityDecisionContext = {
  idempotency?: {
    result: IdempotencyResult;
    existingFingerprint?: string;
    incomingFingerprint?: string;
  };
  priorActionTimestampsMs?: readonly number[];
  transition?: {
    from: string;
    to: string;
    allowedTransitions: Readonly<Record<string, readonly string[]>>;
  };
  ownershipValid?: boolean;
  resourceScopeValid?: boolean;
};

export type IntegrityRewardEligibility = {
  eligible: boolean;
  reason:
    | "ELIGIBLE"
    | "POLICY_NOT_FOUND"
    | "EVIDENCE_NOT_ELIGIBLE"
    | "DECISION_NOT_ALLOW";
};