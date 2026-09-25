import { createHash } from "node:crypto";
import { canonicalJson } from "../study-core/canonicalJson.js";
import { INTEGRITY_LIMITS } from "./constants.js";
import { StudyIntegrityError } from "./errors.js";
import type {
  IntegrityActionEnvelope,
  IntegrityResource,
} from "./types.js";

const FINGERPRINT_NAMESPACE = "99s-guide:study-integrity:v1";
const OBSERVATION_NAMESPACE = "99s-guide:study-integrity-observation:v1";
const TRANSIENT_FIELDS = new Set([
  "receivedat",
  "servertimestamp",
  "createdat",
  "updatedat",
  "requestid",
  "traceid",
  "idempotencykey",
  "clientinstanceid",
  "ruleversion",
  "fingerprint",
  "signature",
]);

function omitTransientFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitTransientFields);
  if (value instanceof Date || value === null || typeof value !== "object") {
    return value;
  }

  const result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const [key, item] of Object.entries(value)) {
    if (!TRANSIENT_FIELDS.has(key.toLowerCase())) {
      result[key] = omitTransientFields(item);
    }
  }
  return result;
}

function hash(namespace: string, payload: unknown, maxBytes: number): string {
  let canonical: string;
  try {
    // Validate the complete input first, including transient fields and cycles.
    canonicalJson(payload, { maxBytes });
    canonical = canonicalJson(omitTransientFields(payload), { maxBytes });
  } catch (error) {
    throw new StudyIntegrityError(
      "INTEGRITY_INVALID_INPUT",
      error instanceof Error ? error.message : "Fingerprint payload is invalid.",
    );
  }

  return createHash("sha256")
    .update(namespace, "utf8")
    .update("\0", "utf8")
    .update(canonical, "utf8")
    .digest("hex");
}

export function fingerprintIntegrityAction(
  action: Pick<
    IntegrityActionEnvelope,
    "actionType" | "userId" | "source" | "evidenceClass" | "occurredAt" | "resource"
  >,
  semanticPayload: unknown = null,
): string {
  if (
    typeof action.actionType !== "string" ||
    action.actionType.length < 1 ||
    action.actionType.length > 96 ||
    typeof action.userId !== "string" ||
    action.userId.length < 1 ||
    action.userId.length > 128 ||
    !(action.occurredAt instanceof Date) ||
    !Number.isSafeInteger(action.occurredAt.getTime()) ||
    action.occurredAt.getTime() < 0
  ) {
    throw new StudyIntegrityError(
      "INTEGRITY_INVALID_INPUT",
      "Fingerprint action identity or occurredAt is invalid.",
    );
  }

  const resource: IntegrityResource | null = action.resource ?? null;
  return hash(
    `${FINGERPRINT_NAMESPACE}:${action.actionType}`,
    {
      actionType: action.actionType,
      userId: action.userId,
      source: action.source,
      evidenceClass: action.evidenceClass,
      occurredAt: action.occurredAt,
      resource,
      semanticPayload,
    },
    INTEGRITY_LIMITS.maxPayloadBytes,
  );
}

export function fingerprintsMatch(
  expected: string,
  actual: string,
): boolean {
  return (
    /^[a-f0-9]{64}$/.test(expected) &&
    /^[a-f0-9]{64}$/.test(actual) &&
    expected === actual
  );
}

export function createObservationDedupFingerprint(input: {
  ruleId: string;
  userId: string;
  actionType: string;
  resource?: IntegrityResource;
  context?: unknown;
}): string {
  if (
    input.ruleId.length < 1 ||
    input.ruleId.length > 128 ||
    input.userId.length < 1 ||
    input.userId.length > 128 ||
    input.actionType.length < 1 ||
    input.actionType.length > 96
  ) {
    throw new StudyIntegrityError(
      "INTEGRITY_INVALID_INPUT",
      "Observation fingerprint identity is invalid or too large.",
    );
  }

  return hash(
    OBSERVATION_NAMESPACE,
    {
      ruleId: input.ruleId,
      userId: input.userId,
      actionType: input.actionType,
      resource: input.resource ?? null,
      context: input.context ?? null,
    },
    INTEGRITY_LIMITS.maxPayloadBytes,
  );
}

export function createReviewGroupingKey(input: {
  userId: string;
  ruleId: string;
  resource?: IntegrityResource;
  occurredAtMs: number;
  bucketMs?: number;
}): {
  userId: string;
  ruleId: string;
  resourceKind: string | null;
  resourceId: string | null;
  timeBucketStartMs: number;
} {
  const bucketMs = input.bucketMs ?? 60 * 60 * 1000;
  if (
    input.userId.length < 1 ||
    input.userId.length > 128 ||
    input.ruleId.length < 1 ||
    input.ruleId.length > 128 ||
    !Number.isSafeInteger(input.occurredAtMs) ||
    input.occurredAtMs < 0 ||
    !Number.isSafeInteger(bucketMs) ||
    bucketMs < 1 ||
    (input.resource !== undefined &&
      (input.resource.kind.length < 1 ||
        input.resource.kind.length > 48 ||
        input.resource.id.length < 1 ||
        input.resource.id.length > 128))
  ) {
    throw new StudyIntegrityError(
      "INTEGRITY_INVALID_INPUT",
      "Review grouping fields must use bounded identifiers and integer milliseconds.",
    );
  }

  return {
    userId: input.userId,
    ruleId: input.ruleId,
    resourceKind: input.resource?.kind ?? null,
    resourceId: input.resource?.id ?? null,
    timeBucketStartMs: Math.floor(input.occurredAtMs / bucketMs) * bucketMs,
  };
}