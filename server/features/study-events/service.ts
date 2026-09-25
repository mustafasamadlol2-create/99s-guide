import { createHash } from "node:crypto";
import {
  PROJECTION_CONTRACT_VERSION,
  STUDY_EVENT_SCHEMA_VERSION,
} from "../study-core/constants.js";
import { canonicalJson } from "../study-core/canonicalJson.js";
import { isStudyFeatureEnabled } from "../study-core/featureFlags.js";
import { buildStudyDailyMetricProjection } from "../study-core/projection.js";
import { logger } from "../../services/logger.js";
import { enqueuePrivateD1Projection } from "../../services/privateD1Sync.js";
import { getBaghdadMetricDate, metricDateAsUtcDate, parseOccurredAt } from "./date.js";
import type { StudyEventType } from "../study-core/events.js";
import { StudyEventError } from "./errors.js";
import { evidenceMeetsPolicy, getMetricDelta, getStudyEventPolicy } from "./eventPolicy.js";
import { studyEventRepository } from "./repository.js";
import { parseStudyEventPayload, studyEventInputSchema } from "./schemas.js";
import type {
  IngestStudyEventInput,
  MetricDelta,
  StudyEventIngestResult,
  StudyEventRecord,
  StudyEventRepository,
  StudyEventTransaction,
} from "./types.js";

const METRIC_COUNTER_FIELDS = [
  "focusSeconds",
  "sessionsCompleted",
  "mcqAttempts",
  "mcqCorrect",
  "flashcardReviews",
  "recallAttempts",
  "recallCorrect",
  "lectureCompletions",
  "interruptionCount",
] as const satisfies readonly (keyof MetricDelta)[];
const MAX_DAILY_COUNTER = 2_147_483_647;

type EnqueueProjection = (
  tx: StudyEventTransaction,
  projection: Record<string, unknown>,
) => Promise<unknown>;

type ServiceOptions = {
  repository?: StudyEventRepository;
  isEnabled?: () => boolean;
  now?: () => Date;
  enqueueProjection?: EnqueueProjection;
};

export type StudyEventIngestionOptions = {
  /** Reuse an existing Prisma transaction so related domain state cannot drift. */
  transaction?: StudyEventTransaction;
};

type NormalizedEvent = {
  eventType: string;
  userId: string;
  occurredAt: string;
  source: string;
  idempotencyKey: string;
  lectureId: string | null;
  materialId: string | null;
  mcqId: string | null;
  flashcardId: string | null;
  focusSessionId: string | null;
  groupFocusRoomId: string | null;
  evidenceClass: string;
  privacyClass: string;
  payload: unknown;
};

function semanticFingerprint(event: NormalizedEvent): string {
  return createHash("sha256").update(canonicalJson(event)).digest("hex");
}

function logMalformedEvent(userId: string | null, errorCode: string): void {
  logger.warn("[StudyEvents]", "Malformed internal event attempt rejected.", {
    userId,
    errorCode,
  });
}

function normalizedRecord(event: Record<string, unknown>): NormalizedEvent {
  const occurredAtValue = event.occurredAt;
  const occurredAt = event.occurredAt instanceof Date
    ? event.occurredAt.toISOString()
    : new Date(String(occurredAtValue)).toISOString();
  return {
    eventType: String(event.eventType),
    userId: String(event.userId),
    occurredAt,
    source: String(event.source),
    idempotencyKey: String(event.idempotencyKey),
    lectureId: typeof event.lectureId === "string" ? event.lectureId : null,
    materialId: typeof event.materialId === "string" ? event.materialId : null,
    mcqId: typeof event.mcqId === "string" ? event.mcqId : null,
    flashcardId: typeof event.flashcardId === "string" ? event.flashcardId : null,
    focusSessionId: typeof event.focusSessionId === "string" ? event.focusSessionId : null,
    groupFocusRoomId: typeof event.groupFocusRoomId === "string" ? event.groupFocusRoomId : null,
    evidenceClass: String(event.evidenceClass),
    privacyClass: String(event.privacyClass),
    payload: event.payload,
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") return false;
  const target = candidate.meta?.target;
  if (target === undefined) return true;
  const fields = Array.isArray(target) ? target.map(String) : [String(target)];
  return fields.includes("userId") && fields.includes("idempotencyKey") ||
    fields.some((field) => field.includes("userId_idempotencyKey"));
}

function replayOrConflict(
  existing: unknown,
  fingerprint: string,
  userId: string,
): StudyEventIngestResult {
  if (!existing || typeof existing !== "object") {
    throw new StudyEventError("IDEMPOTENCY_CONFLICT", "Idempotency key was concurrently claimed.");
  }
  const event = existing as Record<string, unknown>;
  if (semanticFingerprint(normalizedRecord(event)) !== fingerprint) {
    logger.warn("[StudyEvents]", "Idempotency conflict rejected.", {
      userId,
      errorCode: "IDEMPOTENCY_CONFLICT",
    });
    throw new StudyEventError("IDEMPOTENCY_CONFLICT", "Idempotency key was used for a different event.");
  }
  const metricDate = getMetricDelta(
    event.eventType as StudyEventType,
    event.payload,
  )
    ? getBaghdadMetricDate(String(event.occurredAt))
    : undefined;
  return {
    status: "INGESTED",
    event: event as StudyEventRecord,
    idempotency: "REPLAY_SAME_PAYLOAD",
    metricUpdated: false,
    ...(metricDate ? { metricDate } : {}),
  };
}

function validateDelta(delta: MetricDelta): void {
  for (const field of METRIC_COUNTER_FIELDS) {
    const value = delta[field] ?? 0;
    if (!Number.isInteger(value) || value < 0 || value > MAX_DAILY_COUNTER) {
      throw new StudyEventError("INVALID_EVENT", "Metric delta is outside the allowed counter bounds.");
    }
  }
}

async function validateReferences(
  repository: StudyEventRepository,
  tx: StudyEventTransaction,
  event: NormalizedEvent,
  policy: ReturnType<typeof getStudyEventPolicy>,
): Promise<void> {
  for (const field of policy.requiredReferences) {
    if (!event[field as keyof NormalizedEvent]) {
      throw new StudyEventError("INVALID_EVENT", `Required reference ${field} is missing.`);
    }
  }
  for (const field of [
    "lectureId",
    "materialId",
    "mcqId",
    "flashcardId",
    "focusSessionId",
  ] as const) {
    const id = event[field];
    if (id) await repository.validateReference(tx, {
      field,
      id,
      userId: event.userId,
      lectureId: event.lectureId,
    });
  }
}

function metricCreateData(userId: string, metricDate: Date, delta: MetricDelta) {
  const data: Record<string, unknown> = { userId, metricDate };
  for (const field of METRIC_COUNTER_FIELDS) data[field] = delta[field] ?? 0;
  return data;
}

function metricUpdateData(delta: MetricDelta): Record<string, { increment: number }> {
  const data: Record<string, { increment: number }> = {};
  for (const field of METRIC_COUNTER_FIELDS) {
    const value = delta[field] ?? 0;
    if (value > 0) data[field] = { increment: value };
  }
  return data;
}

export function createStudyEventIngestionService(options: ServiceOptions = {}) {
  const repository = options.repository ?? studyEventRepository;
  const isEnabled = options.isEnabled ?? (() => isStudyFeatureEnabled("STUDY_EVENTS_ENABLED"));
  const now = options.now ?? (() => new Date());
  const enqueueProjection: EnqueueProjection = options.enqueueProjection ??
    ((tx, projection) => enqueuePrivateD1Projection(tx, {
      entity: "StudyDailyMetric",
      key: { id: String(projection.id) },
      data: projection,
    }));

  return {
    async ingestStudyEvent<TPayload>(
      input: IngestStudyEventInput<TPayload>,
      ingestionOptions: StudyEventIngestionOptions = {},
    ): Promise<StudyEventIngestResult> {
      if (!isEnabled()) {
        return {
          status: "FEATURE_DISABLED",
          event: null,
          idempotency: null,
          metricUpdated: false,
        };
      }

      const parsedInput = studyEventInputSchema.safeParse(input);
      if (!parsedInput.success) {
        logMalformedEvent(
          typeof input?.userId === "string" ? input.userId.slice(0, 200) : null,
          "INVALID_EVENT",
        );
        throw new StudyEventError("INVALID_EVENT", "Study Event input is invalid.");
      }
      const value = parsedInput.data;
      const policy = getStudyEventPolicy(value.eventType);
      if (!policy.allowedSources.includes(value.source)) {
        logMalformedEvent(value.userId, "INVALID_EVENT");
        throw new StudyEventError("INVALID_EVENT", "Event source is not allowed by policy.");
      }
      if (!evidenceMeetsPolicy(value.evidenceClass, policy.minimumEvidence)) {
        logger.warn("[StudyEvents]", "Insufficient event evidence rejected.", {
          userId: value.userId,
          errorCode: "INVALID_EVIDENCE",
        });
        throw new StudyEventError("INVALID_EVIDENCE", "Event evidence does not meet policy.");
      }
      if (value.privacyClass && value.privacyClass !== policy.privacyClass) {
        logMalformedEvent(value.userId, "INVALID_EVENT");
        throw new StudyEventError("INVALID_EVENT", "Privacy classification is owned by event policy.");
      }

      const clockNow = now();
      let occurredAt: Date;
      let payload: unknown;
      try {
        occurredAt = parseOccurredAt(value.occurredAt, clockNow, value.source);
        payload = parseStudyEventPayload(value.eventType, value.payload);
      } catch {
        logMalformedEvent(value.userId, "INVALID_EVENT");
        throw new StudyEventError("INVALID_EVENT", "Event timestamp or payload is invalid.");
      }

      const semanticEvent: NormalizedEvent = {
        eventType: value.eventType,
        userId: value.userId,
        occurredAt: occurredAt.toISOString(),
        source: value.source,
        idempotencyKey: value.idempotencyKey,
        lectureId: value.lectureId ?? null,
        materialId: value.materialId ?? null,
        mcqId: value.mcqId ?? null,
        flashcardId: value.flashcardId ?? null,
        focusSessionId: value.focusSessionId ?? null,
        groupFocusRoomId: value.groupFocusRoomId ?? null,
        evidenceClass: value.evidenceClass,
        privacyClass: policy.privacyClass,
        payload,
      };
      const fingerprint = semanticFingerprint(semanticEvent);

      const previous = ingestionOptions.transaction
        ? await ingestionOptions.transaction.studyEvent.findUnique({
            where: {
              userId_idempotencyKey: {
                userId: value.userId,
                idempotencyKey: value.idempotencyKey,
              },
            },
          })
        : await repository.findByIdempotency(value.userId, value.idempotencyKey);
      if (previous) return replayOrConflict(previous, fingerprint, value.userId);

      const metricDelta = getMetricDelta(value.eventType, payload as Record<string, unknown>);
      if (metricDelta) validateDelta(metricDelta);
      const metricDate = metricDelta ? getBaghdadMetricDate(occurredAt) : undefined;
      const metricDateValue = metricDate ? metricDateAsUtcDate(metricDate) : undefined;
      const eventData: Record<string, unknown> = {
        schemaVersion: STUDY_EVENT_SCHEMA_VERSION,
        eventType: value.eventType,
        userId: value.userId,
        occurredAt,
        receivedAt: clockNow,
        source: value.source,
        idempotencyKey: value.idempotencyKey,
        lectureId: value.lectureId ?? null,
        materialId: value.materialId ?? null,
        mcqId: value.mcqId ?? null,
        flashcardId: value.flashcardId ?? null,
        focusSessionId: value.focusSessionId ?? null,
        groupFocusRoomId: value.groupFocusRoomId ?? null,
        evidenceClass: value.evidenceClass,
        privacyClass: policy.privacyClass,
        payload,
      };

      try {
        const ingestInTransaction = async (tx: StudyEventTransaction) => {
          const existing = await tx.studyEvent.findUnique({
            where: {
              userId_idempotencyKey: {
                userId: value.userId,
                idempotencyKey: value.idempotencyKey,
              },
            },
          });
          if (existing) return { replay: existing as Record<string, unknown> };

          await validateReferences(repository, tx, semanticEvent, policy);
          const event = await tx.studyEvent.create({ data: eventData }) as StudyEventRecord;

          if (!metricDelta || !metricDateValue || !metricDate) {
            return { event, metricUpdated: false as const };
          }

          const metric = await tx.studyDailyMetric.upsert({
            where: {
              userId_metricDate: {
                userId: value.userId,
                metricDate: metricDateValue,
              },
            },
            create: metricCreateData(value.userId, metricDateValue, metricDelta),
            update: metricUpdateData(metricDelta),
          }) as Record<string, unknown>;
          const storedMetricDate = metric.metricDate instanceof Date
            ? metric.metricDate.toISOString().slice(0, 10)
            : String(metric.metricDate);
          const projection = buildStudyDailyMetricProjection({
            metric: {
              id: String(metric.id),
              userId: String(metric.userId),
              metricDate: storedMetricDate,
              focusSeconds: Number(metric.focusSeconds),
              sessionsCompleted: Number(metric.sessionsCompleted),
              mcqAttempts: Number(metric.mcqAttempts),
              mcqCorrect: Number(metric.mcqCorrect),
              flashcardReviews: Number(metric.flashcardReviews),
              recallAttempts: Number(metric.recallAttempts),
              recallCorrect: Number(metric.recallCorrect),
              lectureCompletions: Number(metric.lectureCompletions),
              interruptionCount: Number(metric.interruptionCount),
              updatedAt: metric.updatedAt as Date,
            },
            revision: "0",
            projectionVersion: PROJECTION_CONTRACT_VERSION,
          });

          try {
            await enqueueProjection(tx, projection as unknown as Record<string, unknown>);
          } catch {
            logger.error("[StudyEvents]", "Daily metric projection enqueue failed.", {
              userId: value.userId,
              errorCode: "OUTBOX_FAILURE",
            });
            throw new StudyEventError("OUTBOX_FAILURE", "Daily metric projection could not be enqueued.");
          }
          return { event, metricUpdated: true as const, metricDate };
        };
        const result = ingestionOptions.transaction
          ? await ingestInTransaction(ingestionOptions.transaction)
          : await repository.transaction(ingestInTransaction);

        if ("replay" in result) return replayOrConflict(result.replay, fingerprint, value.userId);
        return {
          status: "INGESTED",
          event: result.event,
          idempotency: "FIRST_SEEN",
          metricUpdated: result.metricUpdated,
          ...(result.metricDate ? { metricDate: result.metricDate } : {}),
        };
      } catch (error) {
        if (isUniqueViolation(error)) {
          // A caller-owned interactive transaction may already be aborted by
          // PostgreSQL's unique violation. Do not try to recover it by reading
          // through another connection; let the caller roll back atomically.
          if (ingestionOptions.transaction) throw error;
          const concurrent = await repository.findByIdempotency(value.userId, value.idempotencyKey);
          if (concurrent) return replayOrConflict(concurrent, fingerprint, value.userId);
        }
        if (error instanceof StudyEventError) {
          if (
            error.code === "INVALID_EVENT" ||
            error.code === "OWNERSHIP_MISMATCH" ||
            error.code === "CANONICAL_REFERENCE_NOT_FOUND"
          ) logMalformedEvent(value.userId, error.code);
          throw error;
        }
        logger.error("[StudyEvents]", "Unexpected event ingestion failure.", {
          userId: value.userId,
          errorCode: "INGEST_FAILURE",
        });
        throw error;
      }
    },
  };
}

const defaultStudyEventIngestionService = createStudyEventIngestionService();

export const ingestStudyEvent =
  defaultStudyEventIngestionService.ingestStudyEvent;