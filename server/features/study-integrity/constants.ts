import type { PrivacyClass } from "../study-core/privacy.js";

export const STUDY_INTEGRITY_RULE_VERSION = "study-integrity-v1";
export const DEFAULT_INTEGRITY_PRIVACY: PrivacyClass = "ADMIN_SECURITY";

export const INTEGRITY_LIMITS = Object.freeze({
  maxPayloadBytes: 32 * 1024,
  maxEnvelopeMetadataBytes: 4 * 1024,
  maxObservationDetailsBytes: 4 * 1024,
  maxObservationDetailKeys: 16,
  maxObservationDetailDepth: 4,
  maxObservationDetailStringLength: 256,
  maxObservationDetailArrayItems: 16,
  maxClientInstanceIdLength: 128,
  maxResourceKindLength: 48,
  maxResourceIdLength: 128,
  maxIdempotencyKeyLength: 256,
  maxRateHistoryItems: 10_000,
  clientFutureSkewMs: 2 * 60 * 1000,
  clientPastWindowMs: 24 * 60 * 60 * 1000,
  timestampBoundaryReviewMs: 30 * 1000,
});

export const INTEGRITY_OBSERVATION_CATEGORIES = Object.freeze([
  "IDEMPOTENCY",
  "RATE",
  "TIMING",
  "STATE",
  "SOURCE",
  "EVIDENCE",
  "PAYLOAD",
  "REPLAY",
  "OWNERSHIP",
] as const);

export type IntegrityObservationCategory =
  (typeof INTEGRITY_OBSERVATION_CATEGORIES)[number];

/**
 * These describe technical processing only: BLOCK rejects the current action,
 * REVIEW allows it with a private observation, and INFO records an expected
 * condition such as retry. None proves misconduct; all details use
 * ADMIN_SECURITY by default and are redacted before construction.
 */
export const INTEGRITY_OBSERVATION_CATALOG = Object.freeze({
  POLICY_NOT_FOUND: {
    category: "EVIDENCE",
    severity: "BLOCK",
    ruleId: "integrity.policy.not-found.v1",
  },
  // Same semantic request under its idempotency key; normal network retry.
  DUPLICATE_REPLAY: {
    category: "REPLAY",
    severity: "INFO",
    ruleId: "integrity.idempotency.same-payload.v1",
  },
  // Reused key with different semantics; reject this request, not a misconduct verdict.
  IDEMPOTENCY_CONFLICT: {
    category: "IDEMPOTENCY",
    severity: "BLOCK",
    ruleId: "integrity.idempotency.conflict.v1",
  },
  // Fixed window exceeded; rate alone does not prove abuse.
  RATE_WINDOW_EXCEEDED: {
    category: "RATE",
    severity: "REVIEW",
    ruleId: "integrity.rate.window.v1",
  },
  // Client event time outside its explicit retrospective bound.
  TIMESTAMP_TOO_FAR_PAST: {
    category: "TIMING",
    severity: "BLOCK",
    ruleId: "integrity.time.past-bound.v1",
  },
  // Client event time outside its explicit future-skew bound.
  TIMESTAMP_TOO_FAR_FUTURE: {
    category: "TIMING",
    severity: "BLOCK",
    ruleId: "integrity.time.future-bound.v1",
  },
  TIMESTAMP_NEAR_BOUNDARY: {
    category: "TIMING",
    severity: "REVIEW",
    ruleId: "integrity.time.boundary.v1",
  },
  // Structurally invalid timestamp or duration; unusual but valid time is not flagged.
  TIMING_IMPOSSIBLE: {
    category: "TIMING",
    severity: "BLOCK",
    ruleId: "integrity.time.impossible.v1",
  },
  // Transition absent from the feature's canonical state map.
  INVALID_STATE_TRANSITION: {
    category: "STATE",
    severity: "BLOCK",
    ruleId: "integrity.state.transition.v1",
  },
  // Feature service reports that the resource is outside the action's scope.
  RESOURCE_SCOPE_MISMATCH: {
    category: "OWNERSHIP",
    severity: "BLOCK",
    ruleId: "integrity.resource.scope.v1",
  },
  // Feature service reports ownership failure; Integrity performs no lookup.
  OWNERSHIP_MISMATCH: {
    category: "OWNERSHIP",
    severity: "BLOCK",
    ruleId: "integrity.ownership.check.v1",
  },
  // Source is not allowed for this policy or server-owned evidence claim.
  SOURCE_NOT_ALLOWED: {
    category: "SOURCE",
    severity: "BLOCK",
    ruleId: "integrity.source.allowed.v1",
  },
  // Evidence is below the policy minimum or misses its exact required class.
  EVIDENCE_INSUFFICIENT: {
    category: "EVIDENCE",
    severity: "BLOCK",
    ruleId: "integrity.evidence.minimum.v1",
  },
  // Privacy is fixed by server policy and may not be promoted to public.
  PRIVACY_CLASS_NOT_ALLOWED: {
    category: "EVIDENCE",
    severity: "BLOCK",
    ruleId: "integrity.privacy.allowed.v1",
  },
  // Unsupported/cyclic structured input; no content interpretation is attempted.
  PAYLOAD_INVALID: {
    category: "PAYLOAD",
    severity: "BLOCK",
    ruleId: "integrity.payload.valid.v1",
  },
  // Structured payload exceeds the explicit policy ceiling.
  PAYLOAD_TOO_LARGE: {
    category: "PAYLOAD",
    severity: "BLOCK",
    ruleId: "integrity.payload.size.v1",
  },
} as const);

export type IntegrityObservationCode = keyof typeof INTEGRITY_OBSERVATION_CATALOG;
export type IntegrityObservationSeverity = "INFO" | "REVIEW" | "BLOCK";

export const INTEGRITY_ACTION_TYPES = Object.freeze({
  CLIENT_OBSERVATION: "study.client_observation",
  FOCUS_SESSION_START: "focus.session.start",
  FOCUS_SESSION_COMPLETE: "focus.session.complete",
  FOCUS_INTERRUPTION_RECORD: "focus.interruption.record",
  FOCUS_RESOURCE_HANDOFF_START: "focus.resource_handoff.start",
  FOCUS_RESOURCE_HANDOFF_RETURN: "focus.resource_handoff.return",
  FOCUS_BACKGROUND_ABSENCE: "focus.background_absence.observe",
  STUDY_RESOURCE_OPEN: "study.resource.open",
  GROUP_FOCUS_ROOM_JOIN: "group_focus.room.join",
  GROUP_FOCUS_ROOM_LEAVE: "group_focus.room.leave",
  GROUP_FOCUS_ROUND_COMPLETE: "group_focus.round.complete",
  GROUP_FOCUS_SUMMARY_COMPLETE: "group_focus.summary.complete",
  MCQ_ANSWER: "mcq.answer",
  FLASHCARD_REVIEW: "flashcard.review",
  RECALL_ANSWER: "recall.answer",
  POINTS_AWARD_REQUEST: "points.award.request",
} as const);

export type KnownIntegrityActionType =
  (typeof INTEGRITY_ACTION_TYPES)[keyof typeof INTEGRITY_ACTION_TYPES];