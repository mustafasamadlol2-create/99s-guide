import {
  Prisma,
  type IntegritySignal as DbIntegritySignal,
  type PrismaClient,
} from "@prisma/client";
import { canonicalJson } from "../../study-core/canonicalJson.js";
import { EVIDENCE_CLASSES } from "../../study-core/evidence.js";
import { STUDY_EVENT_SOURCES } from "../../study-core/events.js";
import {
  DEFAULT_INTEGRITY_PRIVACY,
  INTEGRITY_OBSERVATION_CATALOG,
  INTEGRITY_SIGNAL_DEDUP_WINDOW_MS,
  INTEGRITY_SIGNAL_MAX_OCCURRENCES,
  INTEGRITY_SIGNAL_SAFE_DETAILS_MAX_BYTES,
  type IntegrityObservationCategory,
  type IntegrityObservationCode,
} from "../constants.js";
import { createObservationDedupFingerprint } from "../fingerprint.js";
import { sanitizeIntegrityDetails } from "../observations.js";
import { getIntegrityPolicy } from "../policy.js";
import { getPrisma } from "../../../services/prismaClient.js";
import { toIntegritySignalDto } from "./dto.js";
import { lockIntegritySignalDedupKey } from "./locks.js";
import {
  StudyIntegrityPersistenceError,
  type IntegritySignalDto,
  type RecordedIntegrityDecision,
  type RecordedIntegrityObservation,
  type IntegritySignalRecordInput,
} from "./types.js";

const SEVERITY_RANK = { INFO: 0, REVIEW: 1, BLOCK: 2 } as const;
const UNRESOLVED_STATUSES = ["OPEN", "ACKNOWLEDGED"] as const;

type PreparedObservation = {
  index: number;
  userId: string;
  actionType: string;
  observationCode: IntegrityObservationCode;
  category: IntegrityObservationCategory;
  severity: "REVIEW" | "BLOCK";
  ruleId: string;
  ruleVersion: string;
  evidenceClass: string;
  source: string;
  privacyClass: string;
  signalFingerprint: string;
  dedupBucket: number;
  resourceKind: string | null;
  resourceId: string | null;
  occurredAt: Date;
  receivedAt: Date;
  latestSafeDetails: Prisma.InputJsonValue;
};

function isValidDate(value: Date): boolean {
  return value instanceof Date
    && Number.isSafeInteger(value.getTime())
    && value.getTime() >= 0;
}

function validateIdentity(input: IntegritySignalRecordInput): void {
  const { envelope, decision } = input;
  if (
    typeof envelope.userId !== "string"
    || envelope.userId.length < 1
    || envelope.userId.length > 128
    || typeof envelope.actionType !== "string"
    || envelope.actionType.length < 1
    || envelope.actionType.length > 96
    || !isValidDate(envelope.receivedAt)
    || !isValidDate(decision.trustedOccurredAt)
    || typeof decision.ruleVersion !== "string"
    || decision.ruleVersion.length < 1
    || decision.ruleVersion.length > 128
    || !(EVIDENCE_CLASSES as readonly string[]).includes(
      decision.effectiveEvidenceClass,
    )
    || !(STUDY_EVENT_SOURCES as readonly string[]).includes(envelope.source)
    || !Array.isArray(decision.observations)
  ) {
    throw new StudyIntegrityPersistenceError(
      "INVALID_INPUT",
      "Integrity decision identity or timestamps are invalid.",
    );
  }

  const policy = getIntegrityPolicy(envelope.actionType);
  const expectedPrivacy = policy?.privacyClass ?? DEFAULT_INTEGRITY_PRIVACY;
  if (
    envelope.privacyClass !== expectedPrivacy
    || (policy && !policy.allowedPrivacyClasses.includes(envelope.privacyClass))
  ) {
    throw new StudyIntegrityPersistenceError(
      "INVALID_INPUT",
      "Integrity privacy class does not match the originating policy.",
    );
  }

  if (
    envelope.resource
    && (
      typeof envelope.resource.kind !== "string"
      || envelope.resource.kind.length < 1
      || envelope.resource.kind.length > 48
      || typeof envelope.resource.id !== "string"
      || envelope.resource.id.length < 1
      || envelope.resource.id.length > 128
    )
  ) {
    throw new StudyIntegrityPersistenceError(
      "INVALID_INPUT",
      "Integrity resource identity is invalid.",
    );
  }
}

function normalizedObservationDetails(
  observationCode: string,
  details: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const identityKeys: Partial<Record<string, readonly string[]>> = {
    INVALID_STATE_TRANSITION: ["from", "to"],
    EVIDENCE_INSUFFICIENT: ["actualEvidence", "minimumEvidence", "requiredEvidence"],
    SOURCE_NOT_ALLOWED: ["source", "evidenceClass"],
    PRIVACY_CLASS_NOT_ALLOWED: ["privacyClass"],
    PAYLOAD_TOO_LARGE: ["field", "maxBytes"],
    RATE_WINDOW_EXCEEDED: ["limit", "burstAllowance"],
  };
  const normalized: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of identityKeys[observationCode] ?? []) {
    if (Object.hasOwn(details, key)) normalized[key] = details[key];
  }
  return normalized;
}

function prepareObservation(
  input: IntegritySignalRecordInput,
  observation: IntegritySignalRecordInput["decision"]["observations"][number],
  index: number,
): PreparedObservation | null {
  const { envelope, decision } = input;
  if (
    !observation
    || typeof observation !== "object"
    || typeof observation.code !== "string"
    || typeof observation.category !== "string"
    || typeof observation.ruleId !== "string"
    || !["INFO", "REVIEW", "BLOCK"].includes(observation.severity)
    || !observation.details
    || typeof observation.details !== "object"
    || Array.isArray(observation.details)
  ) {
    throw new StudyIntegrityPersistenceError(
      "INVALID_INPUT",
      "Integrity observation fields are invalid.",
    );
  }
  const catalog = (
    INTEGRITY_OBSERVATION_CATALOG as Record<
      string,
      { category: string; severity: string; ruleId: string }
    >
  )[observation.code];
  const severityAllowed = observation.code === "RATE_WINDOW_EXCEEDED"
    ? observation.severity === "REVIEW" || observation.severity === "BLOCK"
    : observation.severity === catalog?.severity;
  if (
    !catalog
    || !severityAllowed
    || observation.category !== catalog.category
    || observation.ruleId !== catalog.ruleId
  ) {
    throw new StudyIntegrityPersistenceError(
      "INVALID_INPUT",
      "Integrity observation does not match the deterministic observation catalog.",
    );
  }

  if (observation.severity === "INFO") return null;
  if (observation.severity !== "REVIEW" && observation.severity !== "BLOCK") {
    throw new StudyIntegrityPersistenceError(
      "INVALID_INPUT",
      "Integrity observation severity is invalid.",
    );
  }

  const safeDetails = sanitizeIntegrityDetails(observation.details);
  let serializedDetails: string;
  try {
    serializedDetails = canonicalJson(safeDetails, {
      maxBytes: INTEGRITY_SIGNAL_SAFE_DETAILS_MAX_BYTES,
    });
  } catch {
    throw new StudyIntegrityPersistenceError(
      "INVALID_INPUT",
      "Sanitized integrity details exceed the persistence size limit.",
    );
  }

  let signalFingerprint: string;
  try {
    signalFingerprint = createObservationDedupFingerprint({
      ruleId: observation.ruleId,
      userId: envelope.userId,
      actionType: envelope.actionType,
      resource: envelope.resource,
      context: {
        observationCode: observation.code,
        category: observation.category,
        ruleSetVersion: decision.ruleVersion,
        source: envelope.source,
        evidenceClass: decision.effectiveEvidenceClass,
        privacyClass: envelope.privacyClass,
        identityDetails: normalizedObservationDetails(
          observation.code,
          safeDetails,
        ),
      },
    });
  } catch {
    throw new StudyIntegrityPersistenceError(
      "INVALID_INPUT",
      "Integrity observation fingerprint could not be created.",
    );
  }

  return {
    index,
    userId: envelope.userId,
    actionType: envelope.actionType,
    observationCode: observation.code,
    category: observation.category,
    severity: observation.severity,
    ruleId: observation.ruleId,
    ruleVersion: decision.ruleVersion,
    evidenceClass: decision.effectiveEvidenceClass,
    source: envelope.source,
    privacyClass: envelope.privacyClass,
    signalFingerprint,
    dedupBucket: Math.floor(
      envelope.receivedAt.getTime() / INTEGRITY_SIGNAL_DEDUP_WINDOW_MS,
    ),
    resourceKind: envelope.resource?.kind ?? null,
    resourceId: envelope.resource?.id ?? null,
    occurredAt: new Date(decision.trustedOccurredAt.getTime()),
    receivedAt: new Date(envelope.receivedAt.getTime()),
    latestSafeDetails: JSON.parse(serializedDetails) as Prisma.InputJsonValue,
  };
}

function assertSameSignalIdentity(
  existing: DbIntegritySignal,
  prepared: PreparedObservation,
): void {
  if (
    existing.actionType !== prepared.actionType
    || existing.observationCode !== prepared.observationCode
    || existing.category !== prepared.category
    || existing.ruleId !== prepared.ruleId
    || existing.ruleVersion !== prepared.ruleVersion
    || existing.evidenceClass !== prepared.evidenceClass
    || existing.source !== prepared.source
    || existing.privacyClass !== prepared.privacyClass
    || existing.resourceKind !== prepared.resourceKind
    || existing.resourceId !== prepared.resourceId
  ) {
    throw new StudyIntegrityPersistenceError(
      "SIGNAL_IDENTITY_CONFLICT",
      "Matching integrity fingerprints resolved to inconsistent signal metadata.",
    );
  }
}

export class StudyIntegrityPersistenceService {
  constructor(
    private readonly database: PrismaClient = getPrisma() as PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async recordIntegrityDecision(
    input: IntegritySignalRecordInput,
  ): Promise<RecordedIntegrityDecision> {
    if (!input || typeof input !== "object" || !input.envelope || !input.decision) {
      throw new StudyIntegrityPersistenceError(
        "INVALID_INPUT",
        "Integrity decision input is invalid.",
      );
    }
    validateIdentity(input);
    if (
      !["ALLOW", "ALLOW_WITH_OBSERVATION", "REJECT"].includes(
        input.decision.outcome,
      )
      ||
      input.decision.observations.some(
        (observation) => observation?.severity === "BLOCK",
      ) !== (input.decision.outcome === "REJECT")
      || (
        input.decision.observations.some(
          (observation) => observation?.severity === "REVIEW",
        )
        && input.decision.outcome === "ALLOW"
      )
    ) {
      throw new StudyIntegrityPersistenceError(
        "INVALID_INPUT",
        "Integrity outcome does not match its block observations.",
      );
    }
    const prepared = input.decision.observations.map((observation, index) =>
      prepareObservation(input, observation, index),
    );
    const toPersist = prepared.filter(
      (item): item is PreparedObservation => item !== null,
    );
    if (toPersist.length === 0) {
      return {
        persisted: false,
        observations: input.decision.observations.map((observation) => ({
          observationCode: observation.code,
          persisted: false,
          replayedIntoExisting: false,
          reason: "INFO",
        })),
      };
    }

    const persistedResults = new Map<number, RecordedIntegrityObservation>();
    await this.database.$transaction(async (tx) => {
      const ordered = [...toPersist].sort((left, right) =>
        left.userId.localeCompare(right.userId)
        || left.signalFingerprint.localeCompare(right.signalFingerprint)
        || left.dedupBucket - right.dedupBucket
        || left.index - right.index,
      );
      for (const item of ordered) {
        const result = await this.recordOne(tx, item);
        persistedResults.set(item.index, result);
      }
    }, { maxWait: 5_000, timeout: 15_000 });

    const observations: RecordedIntegrityObservation[] =
      input.decision.observations.map((observation, index) => {
        const result = persistedResults.get(index);
        if (result) return result;
        if (observation.severity !== "INFO") {
          throw new StudyIntegrityPersistenceError(
            "INVALID_INPUT",
            "A review-worthy integrity observation was not persisted.",
          );
        }
        return {
          observationCode: observation.code,
          persisted: false,
          replayedIntoExisting: false,
          reason: "INFO",
        };
      });
    return {
      persisted: observations.some((observation) => observation.persisted),
      observations,
    };
  }

  private async recordOne(
    tx: Prisma.TransactionClient,
    prepared: PreparedObservation,
  ): Promise<RecordedIntegrityObservation> {
    await lockIntegritySignalDedupKey(tx, prepared);
    const existing = await tx.integritySignal.findFirst({
      where: {
        userId: prepared.userId,
        signalFingerprint: prepared.signalFingerprint,
        dedupBucket: prepared.dedupBucket,
        status: { in: [...UNRESOLVED_STATUSES] },
      },
      orderBy: { generation: "desc" },
    });

    if (!existing) {
      const latestGeneration = await tx.integritySignal.aggregate({
        where: {
          userId: prepared.userId,
          signalFingerprint: prepared.signalFingerprint,
          dedupBucket: prepared.dedupBucket,
        },
        _max: { generation: true },
      });
      const generation = (latestGeneration._max.generation ?? -1) + 1;
      const signal = await tx.integritySignal.create({
        data: {
          userId: prepared.userId,
          actionType: prepared.actionType,
          observationCode: prepared.observationCode,
          category: prepared.category,
          severity: prepared.severity,
          ruleId: prepared.ruleId,
          ruleVersion: prepared.ruleVersion,
          evidenceClass: prepared.evidenceClass,
          source: prepared.source,
          privacyClass: prepared.privacyClass,
          signalFingerprint: prepared.signalFingerprint,
          dedupBucket: prepared.dedupBucket,
          generation,
          resourceKind: prepared.resourceKind,
          resourceId: prepared.resourceId,
          firstOccurredAt: prepared.occurredAt,
          lastOccurredAt: prepared.occurredAt,
          lastReceivedAt: prepared.receivedAt,
          occurrenceCount: 1,
          status: "OPEN",
          reviewVersion: 0,
          latestSafeDetails: prepared.latestSafeDetails,
        },
      });
      return {
        observationCode: prepared.observationCode,
        persisted: true,
        replayedIntoExisting: false,
        signal: toIntegritySignalDto(signal),
      };
    }

    assertSameSignalIdentity(existing, prepared);
    if (existing.occurrenceCount >= INTEGRITY_SIGNAL_MAX_OCCURRENCES) {
      throw new StudyIntegrityPersistenceError(
        "OCCURRENCE_COUNT_OVERFLOW",
        "Integrity signal occurrence count reached its database limit.",
      );
    }
    const severity = SEVERITY_RANK[prepared.severity] > SEVERITY_RANK[
      existing.severity as keyof typeof SEVERITY_RANK
    ]
      ? prepared.severity
      : existing.severity;
    const updated = await tx.$queryRaw<DbIntegritySignal[]>(Prisma.sql`
      UPDATE "IntegritySignal"
      SET
        "occurrenceCount" = "occurrenceCount" + 1,
        "lastOccurredAt" = GREATEST("lastOccurredAt", ${prepared.occurredAt}),
        "lastReceivedAt" = GREATEST("lastReceivedAt", ${prepared.receivedAt}),
        "severity" = ${severity},
        "latestSafeDetails" = ${JSON.stringify(prepared.latestSafeDetails)}::jsonb,
        "updatedAt" = ${this.now()}
      WHERE "id" = ${existing.id}
        AND "occurrenceCount" < ${INTEGRITY_SIGNAL_MAX_OCCURRENCES}
      RETURNING *
    `);
    const signal = updated[0];
    if (!signal) {
      throw new StudyIntegrityPersistenceError(
        "OCCURRENCE_COUNT_OVERFLOW",
        "Integrity signal occurrence count reached its database limit.",
      );
    }
    return {
      observationCode: prepared.observationCode,
      persisted: true,
      replayedIntoExisting: true,
      signal: toIntegritySignalDto(signal),
    };
  }
}