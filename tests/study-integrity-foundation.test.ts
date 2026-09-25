import assert from "node:assert/strict";
import test from "node:test";
import {
  EVIDENCE_CLASS_RANK,
  EVIDENCE_CLASSES,
} from "../server/features/study-core/evidence.js";
import { PRIVACY_CLASSES } from "../server/features/study-core/privacy.js";
import { FOCUS_ALLOWED_TRANSITIONS } from "../server/features/study-core/focus.js";
import { canonicalJson } from "../server/features/study-core/canonicalJson.js";
import {
  INTEGRITY_ACTION_TYPES,
  INTEGRITY_LIMITS,
  STUDY_INTEGRITY_RULE_VERSION,
  adaptStudyEventToIntegrityAction,
  assessIntegrityTimestamp,
  createIntegrityActionEnvelope,
  createIntegrityObservation,
  createObservationDedupFingerprint,
  createReviewGroupingKey,
  evaluateIntegrityAction,
  evaluateRateWindow,
  fingerprintIntegrityAction,
  fingerprintsMatch,
  getIntegrityPolicy,
  isValidIntegrityInstant,
  isEvidenceEligibleForReward,
  meetsEvidenceRequirement,
  meetsIntegrityEvidencePolicy,
  normalizeIntegritySubject,
  ownershipObservation,
  resourceScopeObservation,
  sanitizeIntegrityDetails,
  validateDurationSeconds,
  validateSourceEvidencePair,
  validateTransition,
} from "../server/features/study-integrity/index.js";
import type {
  IntegrityActionEnvelope,
  IntegrityPolicy,
} from "../server/features/study-integrity/types.js";

const receivedAt = new Date("2026-09-25T10:00:00.000Z");
const occurredAt = new Date("2026-09-25T09:59:00.000Z");

function action(
  actionType: string = INTEGRITY_ACTION_TYPES.CLIENT_OBSERVATION,
  overrides: Partial<Omit<IntegrityActionEnvelope, "privacyClass">> = {},
): IntegrityActionEnvelope {
  return createIntegrityActionEnvelope({
    actionType,
    userId: "user-17",
    source: "web",
    evidenceClass: "UNVERIFIED_CLIENT",
    occurredAt,
    receivedAt,
    ...overrides,
  });
}

test("integrity reuses the exact frozen evidence and privacy vocabularies", () => {
  assert.deepEqual(EVIDENCE_CLASSES, [
    "UNVERIFIED_CLIENT",
    "CLIENT_OBSERVED",
    "SERVER_VALIDATED",
    "SERVER_DERIVED",
    "REALTIME_VERIFIED",
    "ADMIN_VERIFIED",
  ]);
  assert.deepEqual(EVIDENCE_CLASS_RANK, {
    UNVERIFIED_CLIENT: 0,
    CLIENT_OBSERVED: 1,
    SERVER_VALIDATED: 2,
    SERVER_DERIVED: 3,
    REALTIME_VERIFIED: 3,
    ADMIN_VERIFIED: 4,
  });
  assert.deepEqual(PRIVACY_CLASSES, [
    "PUBLIC",
    "PROFILE_PUBLIC",
    "PRIVATE_STUDY",
    "ADMIN_SECURITY",
    "SYSTEM_INTERNAL",
  ]);
  assert.equal(meetsEvidenceRequirement("SERVER_VALIDATED", "SERVER_VALIDATED"), true);
  assert.equal(meetsEvidenceRequirement("ADMIN_VERIFIED", "SERVER_VALIDATED"), true);
  assert.equal(meetsEvidenceRequirement("UNVERIFIED_CLIENT", "SERVER_VALIDATED"), false);
});

test("equal rank does not make REALTIME_VERIFIED and SERVER_DERIVED interchangeable", () => {
  assert.equal(
    meetsIntegrityEvidencePolicy("SERVER_DERIVED", {
      minimumEvidence: "REALTIME_VERIFIED",
      requiredEvidenceClass: "REALTIME_VERIFIED",
    }),
    false,
  );
  assert.equal(
    meetsIntegrityEvidencePolicy("REALTIME_VERIFIED", {
      minimumEvidence: "REALTIME_VERIFIED",
      requiredEvidenceClass: "REALTIME_VERIFIED",
    }),
    true,
  );
  assert.equal(meetsEvidenceRequirement("ADMIN_VERIFIED", "SERVER_VALIDATED"), true);
});

test("source and evidence matrix rejects client assertions of server-owned facts", () => {
  const clientPolicy = {
    minimumEvidence: "UNVERIFIED_CLIENT",
    allowedSources: ["web", "pwa", "ios", "android", "offline_replay"],
    serverOwnedSources: ["backend"],
  } satisfies Pick<
    IntegrityPolicy,
    | "minimumEvidence"
    | "requiredEvidenceClass"
    | "allowedSources"
    | "serverOwnedSources"
  >;
  const backendPolicy = {
    minimumEvidence: "SERVER_VALIDATED",
    allowedSources: ["backend"],
    serverOwnedSources: ["backend"],
  } satisfies Pick<
    IntegrityPolicy,
    | "minimumEvidence"
    | "requiredEvidenceClass"
    | "allowedSources"
    | "serverOwnedSources"
  >;
  const realtimePolicy = {
    minimumEvidence: "REALTIME_VERIFIED",
    requiredEvidenceClass: "REALTIME_VERIFIED",
    allowedSources: ["backend"],
    serverOwnedSources: ["backend"],
  } satisfies Pick<
    IntegrityPolicy,
    | "minimumEvidence"
    | "requiredEvidenceClass"
    | "allowedSources"
    | "serverOwnedSources"
  >;

  assert.equal(validateSourceEvidencePair({
    source: "ios",
    evidenceClass: "UNVERIFIED_CLIENT",
    policy: clientPolicy,
  }).valid, true);
  assert.equal(validateSourceEvidencePair({
    source: "ios",
    evidenceClass: "CLIENT_OBSERVED",
    policy: clientPolicy,
  }).valid, true);
  assert.equal(validateSourceEvidencePair({
    source: "ios",
    evidenceClass: "SERVER_VALIDATED",
    policy: backendPolicy,
  }).valid, false);
  assert.equal(validateSourceEvidencePair({
    source: "backend",
    evidenceClass: "SERVER_VALIDATED",
    policy: backendPolicy,
  }).valid, true);
  assert.equal(validateSourceEvidencePair({
    source: "backend",
    evidenceClass: "SERVER_DERIVED",
    policy: backendPolicy,
  }).valid, true);
  assert.equal(validateSourceEvidencePair({
    source: "backend",
    evidenceClass: "REALTIME_VERIFIED",
    policy: realtimePolicy,
  }).valid, true);
  assert.equal(validateSourceEvidencePair({
    source: "backend",
    evidenceClass: "ADMIN_VERIFIED",
    policy: backendPolicy,
  }).valid, true);
  assert.equal(validateSourceEvidencePair({
    source: "web",
    evidenceClass: "REALTIME_VERIFIED",
    policy: realtimePolicy,
  }).valid, false);
  assert.equal(validateSourceEvidencePair({
    source: "durable_object",
    evidenceClass: "REALTIME_VERIFIED",
    policy: realtimePolicy,
  }).valid, false);
});

test("unknown action policies fail closed and cannot qualify for rewards", () => {
  const unknown = action("future.unregistered.reward_action", {
    source: "backend",
    evidenceClass: "ADMIN_VERIFIED",
  });
  const result = evaluateIntegrityAction(unknown);
  assert.equal(result.outcome, "REJECT");
  assert.equal(result.effectiveEvidenceClass, "UNVERIFIED_CLIENT");
  assert.equal(result.observations[0]?.code, "POLICY_NOT_FOUND");
  assert.equal(
    isEvidenceEligibleForReward({
      actionType: unknown.actionType,
      source: unknown.source,
      decision: result,
    }).eligible,
    false,
  );
});

test("registered policies and nested source/evidence rules are frozen", () => {
  const policy = getIntegrityPolicy(INTEGRITY_ACTION_TYPES.GROUP_FOCUS_SUMMARY_COMPLETE);
  assert.ok(policy);
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Object.isFrozen(policy.allowedSources), true);
  assert.equal(Object.isFrozen(policy.serverOwnedSources), true);
  assert.equal(Object.isFrozen(policy.allowedPrivacyClasses), true);
  assert.equal(Object.isFrozen(policy.timestampPolicy), true);
  assert.equal(Object.isFrozen(policy.rewardEligibleEvidence), true);
});

test("privacy classification is assigned by the policy, not caller-selected", () => {
  const generated = createIntegrityActionEnvelope({
    actionType: INTEGRITY_ACTION_TYPES.STUDY_RESOURCE_OPEN,
    userId: "user-17",
    source: "ios",
    evidenceClass: "CLIENT_OBSERVED",
    occurredAt,
    receivedAt,
    privacyClass: "PUBLIC",
  } as never);
  assert.equal(generated.privacyClass, "ADMIN_SECURITY");

  const forged = { ...generated, privacyClass: "PUBLIC" as const };
  const result = evaluateIntegrityAction(forged);
  assert.equal(result.outcome, "REJECT");
  assert.ok(result.observations.some((item) => item.code === "PRIVACY_CLASS_NOT_ALLOWED"));
});

test("malformed resource objects reject as payload errors without throwing", () => {
  const malformed = {
    ...action(),
    resource: null,
  } as unknown as IntegrityActionEnvelope;
  const result = evaluateIntegrityAction(malformed);
  assert.equal(result.outcome, "REJECT");
  assert.equal(result.observations[0]?.code, "PAYLOAD_INVALID");
});

test("same-payload replay is informational and conflicting idempotency reuse rejects", () => {
  const candidate = action(INTEGRITY_ACTION_TYPES.FOCUS_SESSION_START, {
    source: "ios",
    evidenceClass: "CLIENT_OBSERVED",
    idempotencyKey: "start-1",
  });
  const replay = evaluateIntegrityAction(candidate, {
    idempotency: { result: "REPLAY_SAME_PAYLOAD" },
  });
  assert.equal(replay.outcome, "ALLOW");
  assert.equal(replay.observations[0]?.code, "DUPLICATE_REPLAY");
  assert.equal(replay.observations[0]?.severity, "INFO");

  const firstSeen = evaluateIntegrityAction(candidate, {
    idempotency: { result: "FIRST_SEEN" },
  });
  assert.equal(firstSeen.outcome, "ALLOW");
  assert.equal(firstSeen.observations.length, 0);

  const conflict = evaluateIntegrityAction(candidate, {
    idempotency: { result: "CONFLICTING_PAYLOAD" },
  });
  assert.equal(conflict.outcome, "REJECT");
  assert.equal(conflict.observations[0]?.code, "IDEMPOTENCY_CONFLICT");

  const mismatchedReplay = evaluateIntegrityAction(candidate, {
    idempotency: {
      result: "REPLAY_SAME_PAYLOAD",
      existingFingerprint: "a".repeat(64),
      incomingFingerprint: "b".repeat(64),
    },
  });
  assert.equal(mismatchedReplay.outcome, "REJECT");
  assert.equal(mismatchedReplay.observations[0]?.code, "IDEMPOTENCY_CONFLICT");
});

test("semantic fingerprints are canonical, bounded, domain-separated, and omit transients", () => {
  const identity = {
    actionType: INTEGRITY_ACTION_TYPES.CLIENT_OBSERVATION,
    userId: "user-17",
    source: "web" as const,
    evidenceClass: "UNVERIFIED_CLIENT" as const,
    occurredAt,
  };
  const first = fingerprintIntegrityAction(identity, {
    b: 2,
    a: 1,
    receivedAt: "one",
    idempotencyKey: "key-1",
  });
  const same = fingerprintIntegrityAction(identity, {
    idempotencyKey: "key-2",
    a: 1,
    b: 2,
    receivedAt: "two",
  });
  assert.equal(first, same);
  assert.equal(/^[a-f0-9]{64}$/.test(first), true);
  assert.equal(fingerprintsMatch(first, same), true);
  assert.equal(fingerprintsMatch(first, "not-a-hash"), false);

  assert.notEqual(
    fingerprintIntegrityAction(identity, ["first", "second"]),
    fingerprintIntegrityAction(identity, ["second", "first"]),
  );
  assert.notEqual(
    fingerprintIntegrityAction(identity, { answer: 1 }),
    fingerprintIntegrityAction(identity, { answer: 2 }),
  );

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => fingerprintIntegrityAction(identity, cyclic));
  assert.throws(() =>
    fingerprintIntegrityAction(identity, "x".repeat(INTEGRITY_LIMITS.maxPayloadBytes + 1)),
  );
  assert.throws(() => canonicalJson({ value: undefined }));
});

test("canonical JSON sorts nested keys and preserves array order", () => {
  assert.equal(
    canonicalJson({ b: 2, a: { y: 1, x: 0 } }),
    canonicalJson({ a: { x: 0, y: 1 }, b: 2 }),
  );
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  assert.throws(() => canonicalJson({ huge: "x".repeat(128) }, { maxBytes: 32 }));
  assert.throws(() => canonicalJson(new Array(1)));
  assert.equal(canonicalJson(new Date(-1)), '"1969-12-31T23:59:59.999Z"');
});

test("client timestamp limits are bounded and support per-action overrides", () => {
  const normal = evaluateIntegrityAction(
    action(INTEGRITY_ACTION_TYPES.FOCUS_SESSION_START, {
      source: "web",
      evidenceClass: "CLIENT_OBSERVED",
      occurredAt: receivedAt,
    }),
  );
  assert.equal(normal.outcome, "ALLOW");
  assert.equal(normal.trustedOccurredAt.getTime(), receivedAt.getTime());

  const smallFuture = evaluateIntegrityAction(
    action(INTEGRITY_ACTION_TYPES.FOCUS_SESSION_START, {
      source: "web",
      evidenceClass: "CLIENT_OBSERVED",
      occurredAt: new Date(receivedAt.getTime() + 60_000),
    }),
  );
  assert.equal(smallFuture.outcome, "ALLOW_WITH_OBSERVATION");
  assert.equal(smallFuture.trustedOccurredAt.getTime(), receivedAt.getTime());
  assert.equal(smallFuture.observations[0]?.code, "TIMESTAMP_NEAR_BOUNDARY");

  const farFuture = evaluateIntegrityAction(
    action(INTEGRITY_ACTION_TYPES.FOCUS_SESSION_START, {
      source: "web",
      evidenceClass: "CLIENT_OBSERVED",
      occurredAt: new Date(receivedAt.getTime() + INTEGRITY_LIMITS.clientFutureSkewMs + 1),
    }),
  );
  assert.equal(farFuture.outcome, "REJECT");
  assert.equal(farFuture.observations[0]?.code, "TIMESTAMP_TOO_FAR_FUTURE");

  const farPast = evaluateIntegrityAction(
    action(INTEGRITY_ACTION_TYPES.FOCUS_SESSION_START, {
      source: "web",
      evidenceClass: "CLIENT_OBSERVED",
      occurredAt: new Date(receivedAt.getTime() - INTEGRITY_LIMITS.clientPastWindowMs - 1),
    }),
  );
  assert.equal(farPast.outcome, "REJECT");
  assert.equal(farPast.observations[0]?.code, "TIMESTAMP_TOO_FAR_PAST");
  assert.equal(isValidIntegrityInstant(new Date(Number.MAX_SAFE_INTEGER)), false);

  const extended = assessIntegrityTimestamp({
    occurredAt: new Date(receivedAt.getTime() - 2 * INTEGRITY_LIMITS.clientPastWindowMs),
    receivedAt,
    policy: {
      authority: "CLIENT_BOUNDED",
      acceptClientTimestamp: true,
      replaceWithServerTime: false,
      maxPastMs: 3 * INTEGRITY_LIMITS.clientPastWindowMs,
      maxFutureMs: INTEGRITY_LIMITS.clientFutureSkewMs,
    },
  });
  assert.equal(extended.accepted, true);
});

test("server-owned actions replace device timestamps with server time", () => {
  const result = evaluateIntegrityAction(
    action(INTEGRITY_ACTION_TYPES.FOCUS_SESSION_COMPLETE, {
      source: "backend",
      evidenceClass: "SERVER_VALIDATED",
      occurredAt: new Date(Number.NaN),
    }),
  );
  assert.equal(result.outcome, "ALLOW");
  assert.equal(result.trustedOccurredAt.getTime(), receivedAt.getTime());

  const invalidClientTime = evaluateIntegrityAction(
    action(INTEGRITY_ACTION_TYPES.FOCUS_SESSION_START, {
      source: "web",
      evidenceClass: "CLIENT_OBSERVED",
      occurredAt: new Date(Number.NaN),
    }),
  );
  assert.equal(invalidClientTime.outcome, "REJECT");
  assert.equal(invalidClientTime.observations[0]?.code, "TIMING_IMPOSSIBLE");
});

test("duration validation rejects negative, non-finite, unsafe, and excessive values", () => {
  for (const durationSeconds of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(validateDurationSeconds({ durationSeconds }).valid, false);
  }
  assert.equal(
    validateDurationSeconds({
      durationSeconds: 61,
      bounds: { minSeconds: 1, maxSeconds: 60 },
    }).valid,
    false,
  );
  assert.equal(
    validateDurationSeconds({
      durationSeconds: 60,
      bounds: { minSeconds: 1, maxSeconds: 60 },
    }).valid,
    true,
  );
  const impossible = evaluateIntegrityAction(
    action(INTEGRITY_ACTION_TYPES.FOCUS_SESSION_COMPLETE, {
      source: "backend",
      evidenceClass: "SERVER_VALIDATED",
      durationSeconds: -5,
    }),
  );
  assert.equal(impossible.outcome, "REJECT");
  assert.ok(impossible.observations.some((item) => item.code === "TIMING_IMPOSSIBLE"));
});

test("fixed rate windows are deterministic, bounded, and support burst allowance", () => {
  const rule = { windowSeconds: 60, maxActions: 2 };
  const under = evaluateRateWindow({
    nowMs: 65_000,
    previousActionTimestampsMs: [61_000],
    rule,
  });
  assert.equal(under.count, 2);
  assert.equal(under.allowed, true);
  assert.equal(under.windowStartMs, 60_000);
  assert.equal(under.windowEndMs, 120_000);

  const below = evaluateRateWindow({
    nowMs: 65_000,
    previousActionTimestampsMs: [],
    rule,
  });
  assert.equal(below.count, 1);
  assert.equal(below.allowed, true);

  const over = evaluateRateWindow({
    nowMs: 65_000,
    previousActionTimestampsMs: [61_000, 62_000],
    rule,
  });
  assert.equal(over.count, 3);
  assert.equal(over.allowed, false);

  const rollover = evaluateRateWindow({
    nowMs: 120_000,
    previousActionTimestampsMs: [61_000, 62_000],
    rule,
  });
  assert.equal(rollover.count, 1);
  assert.equal(rollover.allowed, true);

  const burst = evaluateRateWindow({
    nowMs: 65_000,
    previousActionTimestampsMs: [61_000, 62_000],
    rule: { ...rule, burstAllowance: 1 },
  });
  assert.equal(burst.allowed, true);
  assert.deepEqual(
    evaluateRateWindow({
      nowMs: 65_000,
      previousActionTimestampsMs: [61_000],
      rule,
    }),
    under,
  );
});

test("transition validation uses the canonical Focus state map without copying it", () => {
  assert.equal(validateTransition({
    from: "ACTIVE",
    to: "PAUSED",
    allowedTransitions: FOCUS_ALLOWED_TRANSITIONS,
  }).valid, true);
  const invalid = validateTransition({
    from: "PAUSED",
    to: "COMPLETED",
    allowedTransitions: FOCUS_ALLOWED_TRANSITIONS,
  });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.observation?.code, "INVALID_STATE_TRANSITION");
});

test("ownership and resource-scope observations consume normalized service results", () => {
  assert.equal(ownershipObservation(true), undefined);
  assert.equal(ownershipObservation(false)?.code, "OWNERSHIP_MISMATCH");
  assert.equal(resourceScopeObservation(true), undefined);
  assert.equal(resourceScopeObservation(false)?.code, "RESOURCE_SCOPE_MISMATCH");
  const rejected = evaluateIntegrityAction(action(), {
    ownershipValid: false,
    resourceScopeValid: false,
  });
  assert.equal(rejected.outcome, "REJECT");
  assert.deepEqual(
    rejected.observations.map((item) => item.code),
    ["OWNERSHIP_MISMATCH", "RESOURCE_SCOPE_MISMATCH"],
  );
});

test("intentional Focus Resource Handoff is allowed and is not reward evidence", () => {
  const handoff = action(INTEGRITY_ACTION_TYPES.FOCUS_RESOURCE_HANDOFF_START, {
    source: "ios",
    evidenceClass: "CLIENT_OBSERVED",
    metadata: { handoff: "RESOURCE_HANDOFF" },
  });
  const result = evaluateIntegrityAction(handoff);
  assert.equal(result.outcome, "ALLOW");
  assert.equal(result.observations.length, 0);
  assert.equal(
    isEvidenceEligibleForReward({
      actionType: handoff.actionType,
      source: handoff.source,
      decision: result,
    }).eligible,
    false,
  );
});

test("background absence is not automatically a block or cheating observation", () => {
  const background = action(INTEGRITY_ACTION_TYPES.FOCUS_BACKGROUND_ABSENCE, {
    source: "web",
    evidenceClass: "CLIENT_OBSERVED",
  });
  const result = evaluateIntegrityAction(background);
  assert.equal(result.outcome, "ALLOW");
  assert.equal(result.observations.length, 0);
  assert.equal(
    result.observations.some((item) => item.severity === "BLOCK"),
    false,
  );
});

test("PDF open is allowed but not reward-grade; Group Focus membership is not evidence", () => {
  const pdfOpen = action(INTEGRITY_ACTION_TYPES.STUDY_RESOURCE_OPEN, {
    source: "web",
    evidenceClass: "CLIENT_OBSERVED",
    resource: { kind: "lecture", id: "lecture-1" },
  });
  const pdfOpenResult = evaluateIntegrityAction(pdfOpen);
  assert.equal(pdfOpenResult.outcome, "ALLOW");
  assert.equal(
    isEvidenceEligibleForReward({
      actionType: pdfOpen.actionType,
      source: pdfOpen.source,
      decision: pdfOpenResult,
    }).eligible,
    false,
  );

  const membership = action(INTEGRITY_ACTION_TYPES.GROUP_FOCUS_ROOM_JOIN, {
    source: "durable_object",
    evidenceClass: "CLIENT_OBSERVED",
  });
  const membershipResult = evaluateIntegrityAction(membership);
  assert.equal(membershipResult.outcome, "ALLOW");
  assert.equal(
    isEvidenceEligibleForReward({
      actionType: membership.actionType,
      source: membership.source,
      decision: membershipResult,
    }).eligible,
    false,
  );
});

test("backend REALTIME_VERIFIED Group Focus participation can qualify as evidence", () => {
  const summary = action(INTEGRITY_ACTION_TYPES.GROUP_FOCUS_SUMMARY_COMPLETE, {
    source: "backend",
    evidenceClass: "REALTIME_VERIFIED",
    occurredAt: new Date(Number.NaN),
  });
  const result = evaluateIntegrityAction(summary);
  assert.equal(result.outcome, "ALLOW");
  assert.equal(result.effectiveEvidenceClass, "REALTIME_VERIFIED");
  assert.equal(
    isEvidenceEligibleForReward({
      actionType: summary.actionType,
      source: summary.source,
      decision: result,
    }).eligible,
    true,
  );

  const wrongEvidence = action(INTEGRITY_ACTION_TYPES.GROUP_FOCUS_SUMMARY_COMPLETE, {
    source: "backend",
    evidenceClass: "SERVER_DERIVED",
  });
  const wrongEvidenceResult = evaluateIntegrityAction(wrongEvidence);
  assert.equal(wrongEvidenceResult.outcome, "REJECT");
  assert.equal(
    isEvidenceEligibleForReward({
      actionType: wrongEvidence.actionType,
      source: wrongEvidence.source,
      decision: wrongEvidenceResult,
    }).eligible,
    false,
  );
});

test("observation details redact sensitive keys and remain bounded", () => {
  const details = sanitizeIntegrityDetails({
    visibleId: "resource-1",
    safeCount: 3,
    token: "token-value",
    Authorization: "Bearer secret",
    inviteToken: "invite-value",
    capabilityToken: "capability-value",
    resumeToken: "resume-value",
    secret: "secret-value",
    password: "password-value",
    quickNoteContent: "private note",
    questionText: "full question",
    question: "unqualified full question",
    answer: "unqualified answer",
    content: "raw content",
    note: "private note",
    flashcardText: "front and back",
    nested: { signingKey: "private-key", state: "ACTIVE" },
  });
  const serialized = canonicalJson(details);
  for (const secret of [
    "token-value",
    "Bearer secret",
    "invite-value",
    "capability-value",
    "resume-value",
    "secret-value",
    "password-value",
    "private note",
    "full question",
    "front and back",
    "private-key",
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(details.visibleId, "resource-1");
  assert.equal((details.nested as Record<string, unknown>).state, "ACTIVE");

  const manyKeys = Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [`key${index}`, "x".repeat(1000)]),
  );
  const bounded = sanitizeIntegrityDetails(manyKeys);
  assert.ok(Object.keys(bounded).length <= INTEGRITY_LIMITS.maxObservationDetailKeys);
  assert.ok(Buffer.byteLength(canonicalJson(bounded), "utf8") <= INTEGRITY_LIMITS.maxObservationDetailsBytes);
  assert.ok(String(bounded.key0).length <= INTEGRITY_LIMITS.maxObservationDetailStringLength);
});

test("observations carry stable catalog rule IDs and the decision carries a version", () => {
  const result = evaluateIntegrityAction(
    action(INTEGRITY_ACTION_TYPES.FOCUS_SESSION_START, {
      source: "ios",
      evidenceClass: "CLIENT_OBSERVED",
      occurredAt: new Date(receivedAt.getTime() + INTEGRITY_LIMITS.clientFutureSkewMs + 1),
    }),
  );
  assert.equal(result.ruleVersion, STUDY_INTEGRITY_RULE_VERSION);
  assert.equal(result.ruleVersion.length > 0, true);
  assert.ok(result.observations.every((item) => item.ruleId.length > 0));
  assert.equal(createIntegrityObservation("DUPLICATE_REPLAY").ruleId, "integrity.idempotency.same-payload.v1");
});

test("identical envelope, clock, and context produce identical decisions", () => {
  const candidate = action(INTEGRITY_ACTION_TYPES.FOCUS_SESSION_START, {
    source: "web",
    evidenceClass: "CLIENT_OBSERVED",
    occurredAt: new Date(receivedAt.getTime() + 5_000),
  });
  const context = {
    idempotency: { result: "FIRST_SEEN" as const },
    ownershipValid: true,
    resourceScopeValid: true,
  };
  assert.deepEqual(
    evaluateIntegrityAction(candidate, context),
    evaluateIntegrityAction(candidate, context),
  );
});

test("observation dedup and review grouping keys are deterministic and bounded", () => {
  const dedup = {
    ruleId: "integrity.rate.window.v1",
    userId: "user-17",
    actionType: INTEGRITY_ACTION_TYPES.MCQ_ANSWER,
    resource: { kind: "mcq", id: "mcq-3" },
    context: { limit: 20, count: 21 },
  };
  assert.equal(
    createObservationDedupFingerprint(dedup),
    createObservationDedupFingerprint(dedup),
  );
  assert.notEqual(
    createObservationDedupFingerprint(dedup),
    createObservationDedupFingerprint({ ...dedup, context: { limit: 20, count: 22 } }),
  );
  assert.deepEqual(
    createReviewGroupingKey({
      userId: "user-17",
      ruleId: "integrity.rate.window.v1",
      resource: dedup.resource,
      occurredAtMs: 3_700_000,
      bucketMs: 3_600_000,
    }),
    {
      userId: "user-17",
      ruleId: "integrity.rate.window.v1",
      resourceKind: "mcq",
      resourceId: "mcq-3",
      timeBucketStartMs: 3_600_000,
    },
  );
});

test("Study Event adapters normalize Focus and Group Focus facts without persistence", () => {
  const focusStarted = adaptStudyEventToIntegrityAction({
    eventType: "focus_session_started",
    userId: "user-17",
    source: "ios",
    evidenceClass: "CLIENT_OBSERVED",
    occurredAt: occurredAt.toISOString(),
    receivedAt: receivedAt.toISOString(),
    focusSessionId: "focus-1",
    payload: { activeSeconds: 0, questionText: "must not enter metadata" },
  });
  assert.equal(focusStarted.actionType, INTEGRITY_ACTION_TYPES.FOCUS_SESSION_START);
  assert.equal(focusStarted.source, "ios");
  assert.equal(focusStarted.privacyClass, "ADMIN_SECURITY");
  assert.equal(focusStarted.resource?.kind, "focus_session");
  assert.equal(JSON.stringify(focusStarted.metadata).includes("questionText"), false);

  const groupSummary = adaptStudyEventToIntegrityAction({
    eventType: "group_focus_summary_completed",
    userId: "user-17",
    source: "durable_object",
    evidenceClass: "REALTIME_VERIFIED",
    occurredAt: occurredAt.toISOString(),
    receivedAt: receivedAt.toISOString(),
    groupFocusRoomId: "room-1",
  });
  assert.equal(groupSummary.actionType, INTEGRITY_ACTION_TYPES.GROUP_FOCUS_SUMMARY_COMPLETE);
  assert.equal(groupSummary.source, "backend");
  assert.equal(
    (groupSummary.metadata as Record<string, unknown>).upstreamSource,
    "durable_object",
  );
  assert.equal(evaluateIntegrityAction(groupSummary).outcome, "ALLOW");

  const clientServerClaim = adaptStudyEventToIntegrityAction({
    eventType: "mcq_attempted",
    userId: "user-17",
    source: "ios",
    evidenceClass: "SERVER_VALIDATED",
    occurredAt: occurredAt.toISOString(),
    receivedAt: receivedAt.toISOString(),
    mcqId: "mcq-1",
  });
  assert.equal(clientServerClaim.source, "ios");
  assert.equal(evaluateIntegrityAction(clientServerClaim).outcome, "REJECT");
});

test("integrity subjects contain identifiers only and validate client instance hints", () => {
  assert.deepEqual(
    normalizeIntegritySubject({
      userId: "user-17",
      source: "ios",
      clientInstanceId: "install:abc-123",
      sessionId: "session-1",
    }),
    {
      userId: "user-17",
      source: "ios",
      clientInstanceId: "install:abc-123",
      sessionId: "session-1",
    },
  );
  assert.throws(() =>
    normalizeIntegritySubject({
      userId: "user-17",
      source: "ios",
      clientInstanceId: "bad value",
    }),
  );
  assert.throws(() =>
    normalizeIntegritySubject({
      userId: "user-17",
      source: "ios",
      sessionId: "x".repeat(129),
    }),
  );
});