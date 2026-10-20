import type { Prisma } from "@prisma/client";
import { isStudyFeatureEnabled } from "../study-core/featureFlags.js";
import type { EvidenceClass } from "../study-core/evidence.js";
import type { StudyEventSource, StudyEventType } from "../study-core/events.js";
import { StudyEventError } from "../study-events/errors.js";
import type { StudyEventTransaction } from "../study-events/types.js";
import {
  adaptStudyEventToIntegrityAction,
  integrityActionTypeForStudyEvent,
} from "./adapters.js";
import { evaluateIntegrityAction } from "./decision.js";
import { getIntegrityPolicy } from "./policy.js";
import { StudyIntegrityPersistenceService } from "./persistence/service.js";
import type { IntegrityDecision } from "./types.js";

export type StudyEventIntegrityGuardInput = {
  eventType: StudyEventType;
  userId: string;
  source: StudyEventSource;
  evidenceClass: EvidenceClass;
  occurredAt: Date;
  receivedAt: Date;
  idempotencyKey: string;
  lectureId?: string | null;
  materialId?: string | null;
  mcqId?: string | null;
  flashcardId?: string | null;
  focusSessionId?: string | null;
  groupFocusRoomId?: string | null;
  payload?: unknown;
};

function structuredPayload(value: unknown): Record<string, never> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, never>;
}

async function priorActionTimestamps(
  tx: StudyEventTransaction,
  input: StudyEventIntegrityGuardInput,
  windowSeconds: number,
): Promise<number[]> {
  const since = new Date(input.receivedAt.getTime() - windowSeconds * 1_000);
  const rows = await tx.$queryRawUnsafe<Array<{ receivedAt: Date | string }>>(
    `SELECT "receivedAt" FROM "StudyEvent" WHERE "userId" = $1 AND "eventType" = $2 AND "receivedAt" >= $3 ORDER BY "receivedAt" DESC LIMIT 10000`,
    input.userId,
    input.eventType,
    since,
  );
  return rows
    .map((row) => row.receivedAt instanceof Date ? row.receivedAt.getTime() : Date.parse(String(row.receivedAt)))
    .filter((value) => Number.isFinite(value));
}

/**
 * Phase 7 bridge between canonical Study Events and the deterministic
 * Study Integrity evaluator. It is deliberately conservative: normal actions
 * continue, review-worthy bursts are recorded privately, and only deterministic
 * BLOCK decisions can reject an event.
 */
export async function enforceStudyEventIntegrity(
  tx: StudyEventTransaction,
  input: StudyEventIntegrityGuardInput,
): Promise<IntegrityDecision | null> {
  if (!isStudyFeatureEnabled("STUDY_INTEGRITY_ENABLED")) return null;
  const actionType = integrityActionTypeForStudyEvent(input.eventType);
  if (!actionType) return null;
  const policy = getIntegrityPolicy(actionType);
  if (!policy) return null;

  const envelope = adaptStudyEventToIntegrityAction({
    eventType: input.eventType,
    userId: input.userId,
    source: input.source,
    evidenceClass: input.evidenceClass,
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
    idempotencyKey: input.idempotencyKey,
    ...(input.lectureId ? { lectureId: input.lectureId } : {}),
    ...(input.materialId ? { materialId: input.materialId } : {}),
    ...(input.mcqId ? { mcqId: input.mcqId } : {}),
    ...(input.flashcardId ? { flashcardId: input.flashcardId } : {}),
    ...(input.focusSessionId ? { focusSessionId: input.focusSessionId } : {}),
    ...(input.groupFocusRoomId ? { groupFocusRoomId: input.groupFocusRoomId } : {}),
    ...(structuredPayload(input.payload) ? { payload: structuredPayload(input.payload) } : {}),
  });

  const timestamps = policy.rateRule
    ? await priorActionTimestamps(tx, input, policy.rateRule.windowSeconds)
    : undefined;
  const decision = evaluateIntegrityAction(envelope, {
    ownershipValid: true,
    resourceScopeValid: true,
    ...(timestamps ? { priorActionTimestampsMs: timestamps } : {}),
  });

  if (decision.observations.some((observation) => observation.severity !== "INFO")) {
    const persistence = new StudyIntegrityPersistenceService();
    await persistence.recordIntegrityDecision(
      { envelope, decision },
      { transaction: tx as unknown as Prisma.TransactionClient },
    );
  }

  if (decision.outcome === "REJECT") {
    throw new StudyEventError(
      "INVALID_EVENT",
      "Study Event was rejected by the deterministic integrity policy.",
    );
  }
  return decision;
}
