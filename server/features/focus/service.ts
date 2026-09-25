import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  buildFocusPlanProjection,
  buildFocusSessionProjection,
} from "../study-core/projection.js";
import { PROJECTION_CONTRACT_VERSION } from "../study-core/constants.js";
import { isStudyFeatureEnabled } from "../study-core/featureFlags.js";
import { canTransitionFocusSession, type FocusSessionState } from "../study-core/focus.js";
import type { EvidenceClass } from "../study-core/evidence.js";
import type { StudyEventSource, StudyEventType } from "../study-core/events.js";
import {
  abandonFocusTimer,
  buildFocusTimerSnapshot,
  completeFocusTimer,
  FOCUS_TIMER_COMPLETION_TOLERANCE_SECONDS,
  pauseFocusTimer,
  resumeFocusTimer,
  type FocusTimerSession,
} from "./timer.js";
import { FocusError, toFocusError } from "./errors.js";
import {
  abandonFocusSessionSchema,
  completeFocusSessionSchema,
  createFocusPlanSchema,
  focusSessionTransitionSchema,
  startFocusSessionSchema,
  updateFocusPlanSchema,
  type AbandonFocusSessionInput,
  type CompleteFocusSessionInput,
  type CreateFocusPlanInput,
  type FocusSessionTransitionInput,
  type StartFocusSessionInput,
  type UpdateFocusPlanInput,
} from "./schemas.js";
import { FocusRepository, type FocusTransaction } from "./repository.js";
import type { StudyEventRecord } from "../study-events/types.js";
import { ingestStudyEvent } from "../study-events/service.js";
import { enqueuePrivateD1Projection } from "../../services/privateD1Sync.js";
import {
  fetchFocusPlanProjections,
  logPrivateReadFallback,
  privateReadEnabled,
  type FocusPlanReadProjection,
} from "../../services/privateD1Read.js";
import type {
  FocusBackendService,
  FocusCurrentSessionResult,
  FocusPlanDto,
  FocusPlanItemDto,
  FocusSessionDto,
  FocusSessionMutationResult,
} from "./types.js";

const NONTERMINAL_STATES = [
  "CREATED",
  "ACTIVE",
  "PAUSED",
  "RESOURCE_HANDOFF",
  "RECONCILIATION_REQUIRED",
] as const;

type PlanItemRecord = {
  id: string;
  lectureId: string;
  sequence: number;
  sessionCount: number;
  focusDurationSeconds: number;
  breakDurationSeconds: number;
  includeMcq: boolean;
  includeFlashcards: boolean;
  includeVideo: boolean;
};

type PlanRecord = {
  id: string;
  userId: string;
  title: string;
  status: string;
  timezone: string;
  planVersion: number;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  items: PlanItemRecord[];
};

type SessionRecord = {
  id: string;
  userId: string;
  planId: string;
  planItemId: string;
  lectureId: string;
  status: FocusSessionState;
  startedAt: Date | null;
  plannedEndAt: Date | null;
  actualEndedAt: Date | null;
  lastCheckpointAt: Date | null;
  activeSeconds: number;
  pauseSeconds: number;
  completionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  planItem: PlanItemRecord;
};

type FocusEventOperation = "started" | "paused" | "resumed" | "completed" | "abandoned";

type FocusServiceOptions = {
  repository?: FocusRepository;
  prisma?: PrismaClient;
  isFocusEnabled?: () => boolean;
  isStudyEventsEnabled?: () => boolean;
  now?: () => Date;
  d1PlanReadsEnabled?: () => boolean;
  fetchPlansFromD1?: (
    userId: string,
    options: { limit?: number },
  ) => Promise<FocusPlanReadProjection[]>;
};

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function planItemDto(item: PlanItemRecord): FocusPlanItemDto {
  return {
    id: item.id,
    lectureId: item.lectureId,
    sequence: item.sequence,
    sessionCount: item.sessionCount,
    focusDurationSeconds: item.focusDurationSeconds,
    breakDurationSeconds: item.breakDurationSeconds,
    includeMcq: item.includeMcq,
    includeFlashcards: item.includeFlashcards,
    includeVideo: item.includeVideo,
  };
}

function planDto(plan: PlanRecord): FocusPlanDto {
  return {
    id: plan.id,
    title: plan.title,
    status: plan.status,
    timezone: plan.timezone,
    planVersion: plan.planVersion,
    createdAt: iso(plan.createdAt) as string,
    updatedAt: iso(plan.updatedAt) as string,
    archivedAt: iso(plan.archivedAt),
    items: [...plan.items]
      .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
      .map(planItemDto),
  };
}

function d1PlanDto(plan: FocusPlanReadProjection): FocusPlanDto {
  return {
    id: plan.id,
    title: plan.title,
    status: plan.status,
    timezone: plan.timezone,
    planVersion: plan.planVersion,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    archivedAt: plan.archivedAt,
    items: [...plan.items].sort(
      (left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id),
    ),
  };
}

function timerInput(session: SessionRecord): FocusTimerSession {
  return {
    status: session.status as FocusTimerSession["status"],
    startedAt: session.startedAt,
    plannedEndAt: session.plannedEndAt,
    lastCheckpointAt: session.lastCheckpointAt,
    activeSeconds: session.activeSeconds,
    pauseSeconds: session.pauseSeconds,
  };
}

function planSessionNumber(status: string, completedCount: number): number {
  return status === "COMPLETED" ? completedCount : completedCount + 1;
}

function sessionDto(
  session: SessionRecord,
  now: Date,
  completedCount: number,
): FocusSessionDto {
  const timer = buildFocusTimerSnapshot({ session: timerInput(session), now });
  const state = timer.reconciliationRequired
    ? "RECONCILIATION_REQUIRED"
    : session.status;
  const completionEligible =
    timer.completionEligible;
  const sessionNumber = planSessionNumber(session.status, completedCount);

  return {
    id: session.id,
    planId: session.planId,
    planItemId: session.planItemId,
    lectureId: session.lectureId,
    status: state as FocusSessionDto["status"],
    startedAt: iso(session.startedAt),
    plannedEndAt: iso(session.plannedEndAt),
    actualEndedAt: iso(session.actualEndedAt),
    lastCheckpointAt: iso(session.lastCheckpointAt),
    activeSeconds: timer.reconciliationRequired ? null : session.activeSeconds,
    pauseSeconds: timer.reconciliationRequired ? null : session.pauseSeconds,
    serverNow: now.toISOString(),
    elapsedActiveSeconds: timer.elapsedActiveSeconds,
    remainingSeconds: timer.remainingSeconds,
    completionEligible,
    sessionNumber,
    plannedSessionCount: session.planItem.sessionCount,
    isLastPlannedSession: sessionNumber >= session.planItem.sessionCount,
    reconciliationRequired: timer.reconciliationRequired,
    completionReason: session.completionReason,
  };
}

function focusEventKey(
  operation: FocusEventOperation,
  sessionId: string,
  requestIdempotencyKey: string,
): string {
  const digest = createHash("sha256")
    .update(`${sessionId}\u0000${requestIdempotencyKey}`, "utf8")
    .digest("hex");
  return `focus:v1:${operation}:${digest}`;
}

async function findFocusEvent(
  tx: FocusTransaction,
  userId: string,
  key: string,
): Promise<StudyEventRecord | null> {
  return await tx.studyEvent.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
  }) as StudyEventRecord | null;
}

async function ingestFocusEvent(
  tx: FocusTransaction,
  input: {
    eventType: StudyEventType;
    userId: string;
    occurredAt: Date;
    source: StudyEventSource;
    idempotencyKey: string;
    lectureId: string;
    focusSessionId: string;
    evidenceClass: EvidenceClass;
    payload: Record<string, unknown>;
  },
): Promise<"FIRST_SEEN" | "REPLAY_SAME_PAYLOAD"> {
  const existing = await findFocusEvent(tx, input.userId, input.idempotencyKey);
  const result = await ingestStudyEvent({
    ...input,
    occurredAt: existing?.occurredAt ?? input.occurredAt,
  }, { transaction: tx });
  if (result.status === "FEATURE_DISABLED") {
    throw new FocusError("DEPENDENCY_DISABLED", "Study Events must be enabled for Focus sessions.");
  }
  return result.idempotency;
}

async function enqueuePlanProjection(tx: FocusTransaction, plan: PlanRecord): Promise<void> {
  const projection = buildFocusPlanProjection({
    plan,
    items: plan.items,
    revision: "0",
    projectionVersion: PROJECTION_CONTRACT_VERSION,
  });
  try {
    await enqueuePrivateD1Projection(tx, {
      entity: "FocusPlan",
      key: { id: plan.id },
      data: projection as unknown as Record<string, unknown>,
    });
  } catch {
    throw new FocusError("OUTBOX_FAILURE", "Focus Plan projection could not be queued.");
  }
}

async function enqueueSessionProjection(
  tx: FocusTransaction,
  session: SessionRecord,
): Promise<void> {
  const projection = buildFocusSessionProjection({
    session: {
      id: session.id,
      userId: session.userId,
      planId: session.planId,
      planItemId: session.planItemId,
      lectureId: session.lectureId,
      status: session.status,
      startedAt: iso(session.startedAt),
      plannedEndAt: iso(session.plannedEndAt),
      actualEndedAt: iso(session.actualEndedAt),
      lastCheckpointAt: iso(session.lastCheckpointAt),
      activeSeconds: session.activeSeconds,
      pauseSeconds: session.pauseSeconds,
      completionReason: session.completionReason,
      updatedAt: session.updatedAt,
    },
    revision: "0",
    projectionVersion: PROJECTION_CONTRACT_VERSION,
  });
  try {
    await enqueuePrivateD1Projection(tx, {
      entity: "FocusSession",
      key: { id: session.id },
      data: projection as unknown as Record<string, unknown>,
    });
  } catch {
    throw new FocusError("OUTBOX_FAILURE", "Focus Session projection could not be queued.");
  }
}

function rethrowFocusError(error: unknown): never {
  const focusError = toFocusError(error);
  if (focusError) throw focusError;
  throw error;
}

async function safely<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    return rethrowFocusError(error);
  }
}

function assertValidClock(now: Date): Date {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new FocusError("RECONCILIATION_REQUIRED", "Server clock returned an invalid timestamp.");
  }
  return now;
}

async function ownedPlan(
  tx: FocusTransaction,
  userId: string,
  planId: string,
): Promise<PlanRecord> {
  const plan = await tx.focusPlan.findFirst({
    where: { id: planId, userId },
    include: { items: { orderBy: [{ sequence: "asc" }, { id: "asc" }] } },
  }) as PlanRecord | null;
  if (!plan) throw new FocusError("PLAN_NOT_FOUND", "Focus Plan was not found.");
  return plan;
}

async function ownedSession(
  tx: FocusTransaction,
  userId: string,
  sessionId: string,
): Promise<SessionRecord> {
  const session = await tx.focusSession.findFirst({
    where: { id: sessionId, userId },
    include: { planItem: true },
  }) as SessionRecord | null;
  if (!session) throw new FocusError("SESSION_NOT_FOUND", "Focus Session was not found.");
  return session;
}

async function completedCount(
  tx: FocusTransaction,
  userId: string,
  planItemId: string,
): Promise<number> {
  return tx.focusSession.count({
    where: { userId, planItemId, status: "COMPLETED" },
  });
}

async function countNonterminal(
  tx: FocusTransaction,
  userId: string,
  planId?: string,
): Promise<number> {
  return tx.focusSession.count({
    where: {
      userId,
      ...(planId ? { planId } : {}),
      status: { in: [...NONTERMINAL_STATES] },
    },
  });
}

async function getSessionDto(
  tx: FocusTransaction,
  session: SessionRecord,
  now: Date,
): Promise<FocusSessionDto> {
  const count = await completedCount(tx, session.userId, session.planItemId);
  return sessionDto(session, now, count);
}

function requestInputError(message: string): FocusError {
  return new FocusError("INVALID_REQUEST", message);
}

export function createFocusService(options: FocusServiceOptions = {}): FocusBackendService {
  const repository = options.repository ?? new FocusRepository(options.prisma);
  const isFocusEnabled = options.isFocusEnabled ??
    (() => isStudyFeatureEnabled("FOCUS_HUB_ENABLED"));
  const isStudyEventsEnabled = options.isStudyEventsEnabled ??
    (() => isStudyFeatureEnabled("STUDY_EVENTS_ENABLED"));
  const now = options.now ?? (() => new Date());
  const d1PlanReadsEnabled = options.d1PlanReadsEnabled ??
    (() => privateReadEnabled("PRIVATE_D1_FOCUS_PLAN_READS_ENABLED"));
  const fetchPlansFromD1 = options.fetchPlansFromD1 ?? fetchFocusPlanProjections;

  function requireFocus(): void {
    if (!isFocusEnabled()) {
      throw new FocusError("FEATURE_DISABLED", "Focus Hub is disabled.");
    }
  }

  function requireSessionDependencies(): void {
    requireFocus();
    if (!isStudyEventsEnabled()) {
      throw new FocusError("DEPENDENCY_DISABLED", "Study Events must be enabled for Focus sessions.");
    }
  }

  function validatePlanCreate(input: CreateFocusPlanInput): CreateFocusPlanInput {
    const parsed = createFocusPlanSchema.safeParse(input);
    if (!parsed.success) throw requestInputError("Focus Plan request is invalid.");
    if (parsed.data.items.some((item) => item.id !== undefined)) {
      throw requestInputError("New Focus Plan items cannot specify IDs.");
    }
    return parsed.data;
  }

  function validatePlanUpdate(input: UpdateFocusPlanInput): UpdateFocusPlanInput {
    const parsed = updateFocusPlanSchema.safeParse(input);
    if (!parsed.success) throw requestInputError("Focus Plan update is invalid.");
    return parsed.data;
  }

  function validateStart(input: StartFocusSessionInput): StartFocusSessionInput {
    const parsed = startFocusSessionSchema.safeParse(input);
    if (!parsed.success) throw requestInputError("Focus Session start request is invalid.");
    return parsed.data;
  }

  function validateTransition(input: FocusSessionTransitionInput): FocusSessionTransitionInput {
    const parsed = focusSessionTransitionSchema.safeParse(input);
    if (!parsed.success) throw requestInputError("Focus Session transition request is invalid.");
    return parsed.data;
  }

  function validateComplete(input: CompleteFocusSessionInput): CompleteFocusSessionInput {
    const parsed = completeFocusSessionSchema.safeParse(input);
    if (!parsed.success) throw requestInputError("Focus Session completion request is invalid.");
    return parsed.data;
  }

  function validateAbandon(input: AbandonFocusSessionInput): AbandonFocusSessionInput {
    const parsed = abandonFocusSessionSchema.safeParse(input);
    if (!parsed.success) throw requestInputError("Focus Session abandonment request is invalid.");
    return parsed.data;
  }

  return {
    async createPlan(userId, rawInput) {
      requireFocus();
      const input = validatePlanCreate(rawInput);
      return safely(async () => {
        const plan = await repository.transaction(async (tx) => {
          const lectureRows = await tx.lecture.findMany({
            where: { id: { in: [...new Set(input.items.map((item) => item.lectureId))] } },
            select: { id: true },
          }) as Array<{ id: string }>;
          if (lectureRows.length !== new Set(input.items.map((item) => item.lectureId)).size) {
            throw new FocusError("LECTURE_NOT_FOUND", "One or more Lectures were not found.");
          }
          const created = await tx.focusPlan.create({
            data: {
              userId,
              title: input.title,
              timezone: input.timezone,
              status: "ACTIVE",
              items: {
                create: input.items.map((item) => ({
                  lectureId: item.lectureId,
                  sequence: item.sequence,
                  sessionCount: item.sessionCount,
                  focusDurationSeconds: item.focusDurationSeconds,
                  breakDurationSeconds: item.breakDurationSeconds,
                  includeMcq: item.includeMcq,
                  includeFlashcards: item.includeFlashcards,
                  includeVideo: item.includeVideo,
                })),
              },
            },
            include: { items: { orderBy: [{ sequence: "asc" }, { id: "asc" }] } },
          }) as PlanRecord;
          await enqueuePlanProjection(tx, created);
          return created;
        });
        return planDto(plan);
      });
    },

    async listPlans(userId, limit = 100) {
      requireFocus();
      const boundedLimit = Number.isInteger(limit) ? Math.min(100, Math.max(1, limit)) : 100;
      if (d1PlanReadsEnabled()) {
        try {
          const projections = await fetchPlansFromD1(userId, { limit: boundedLimit });
          return projections.map(d1PlanDto);
        } catch (error) {
          logPrivateReadFallback("Focus Plan projection read", error);
        }
      }
      return safely(async () => {
        const rows = await repository.database.focusPlan.findMany({
          where: { userId },
          include: { items: { orderBy: [{ sequence: "asc" }, { id: "asc" }] } },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          take: boundedLimit,
        }) as PlanRecord[];
        return rows.map(planDto);
      });
    },

    async getPlan(userId, planId) {
      requireFocus();
      if (d1PlanReadsEnabled()) {
        try {
          const projections = await fetchPlansFromD1(userId, { limit: 100 });
          const projection = projections.find((plan) => plan.id === planId);
          if (projection) return d1PlanDto(projection);
        } catch (error) {
          logPrivateReadFallback("Focus Plan detail projection read", error);
        }
      }
      return safely(async () => {
        const plan = await repository.database.focusPlan.findFirst({
          where: { id: planId, userId },
          include: { items: { orderBy: [{ sequence: "asc" }, { id: "asc" }] } },
        }) as PlanRecord | null;
        if (!plan) throw new FocusError("PLAN_NOT_FOUND", "Focus Plan was not found.");
        return planDto(plan);
      });
    },

    async updatePlan(userId, planId, rawInput) {
      requireFocus();
      const input = validatePlanUpdate(rawInput);
      return safely(async () => {
        const updated = await repository.transaction(async (tx) => {
          await repository.lockUser(tx, userId);
          const current = await ownedPlan(tx, userId, planId);
          if (current.status !== "ACTIVE") {
            throw new FocusError("PLAN_ARCHIVED", "Archived Focus Plans cannot be edited.");
          }

          if (input.items) {
            if (await countNonterminal(tx, userId, planId) > 0) {
              throw new FocusError("PLAN_HAS_ACTIVE_SESSION", "Plan items cannot be edited while a session is active.");
            }
            const currentById = new Map(current.items.map((item) => [item.id, item]));
            for (const item of input.items) {
              if (item.id && !currentById.has(item.id)) {
                throw new FocusError("PLAN_ITEM_NOT_FOUND", "Focus Plan item was not found.");
              }
            }
            const lectureIds = new Set(input.items.map((item) => item.lectureId));
            const lectureRows = await tx.lecture.findMany({
              where: { id: { in: [...lectureIds] } },
              select: { id: true },
            }) as Array<{ id: string }>;
            if (lectureRows.length !== lectureIds.size) {
              throw new FocusError("LECTURE_NOT_FOUND", "One or more Lectures were not found.");
            }

            const incomingIds = new Set(input.items.flatMap((item) => item.id ? [item.id] : []));
            const removed = current.items.filter((item) => !incomingIds.has(item.id));
            if (removed.length) {
              const history = await tx.focusSession.findFirst({
                where: { userId, planItemId: { in: removed.map((item) => item.id) } },
                select: { id: true },
              });
              if (history) {
                throw new FocusError(
                  "PLAN_ITEM_HAS_HISTORY",
                  "A Focus Plan item with session history cannot be removed.",
                );
              }
            }

            // Move retained items into a temporary negative sequence range so
            // valid sequence swaps do not collide with the unique plan/sequence key.
            for (const [index, item] of current.items.entries()) {
              await tx.focusPlanItem.update({
                where: { id: item.id },
                data: { sequence: -(index + 1) },
              });
            }
            if (removed.length) {
              await tx.focusPlanItem.deleteMany({
                where: { planId, id: { in: removed.map((item) => item.id) } },
              });
            }
          }

          const scalarUpdated = await tx.focusPlan.update({
            where: { id: planId },
            data: {
              ...(input.title !== undefined ? { title: input.title } : {}),
              ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
              planVersion: { increment: 1 },
            },
          });

          if (input.items) {
            const currentById = new Map(current.items.map((item) => [item.id, item]));
            for (const item of input.items) {
              if (item.id) {
                await tx.focusPlanItem.update({
                  where: { id: item.id },
                  data: {
                    lectureId: item.lectureId,
                    sequence: item.sequence,
                    sessionCount: item.sessionCount,
                    focusDurationSeconds: item.focusDurationSeconds,
                    breakDurationSeconds: item.breakDurationSeconds,
                    includeMcq: item.includeMcq,
                    includeFlashcards: item.includeFlashcards,
                    includeVideo: item.includeVideo,
                  },
                });
              } else {
                await tx.focusPlanItem.create({
                  data: {
                    planId,
                    lectureId: item.lectureId,
                    sequence: item.sequence,
                    sessionCount: item.sessionCount,
                    focusDurationSeconds: item.focusDurationSeconds,
                    breakDurationSeconds: item.breakDurationSeconds,
                    includeMcq: item.includeMcq,
                    includeFlashcards: item.includeFlashcards,
                    includeVideo: item.includeVideo,
                  },
                });
              }
            }
            // Guard against accidentally accepting a foreign item ID if the
            // persisted set changed during a future refactor.
            if (input.items.some((item) => item.id && !currentById.has(item.id))) {
              throw new FocusError("PLAN_ITEM_NOT_FOUND", "Focus Plan item was not found.");
            }
          }

          const result = await tx.focusPlan.findFirst({
            where: { id: scalarUpdated.id, userId },
            include: { items: { orderBy: [{ sequence: "asc" }, { id: "asc" }] } },
          }) as PlanRecord | null;
          if (!result) throw new FocusError("PLAN_NOT_FOUND", "Focus Plan was not found.");
          await enqueuePlanProjection(tx, result);
          return result;
        });
        return planDto(updated);
      });
    },

    async archivePlan(userId, planId) {
      requireFocus();
      return safely(async () => {
        const archived = await repository.transaction(async (tx) => {
          await repository.lockUser(tx, userId);
          const current = await ownedPlan(tx, userId, planId);
          if (current.status === "ARCHIVED") return current;
          if (await countNonterminal(tx, userId, planId) > 0) {
            throw new FocusError("PLAN_HAS_ACTIVE_SESSION", "A plan with an active session cannot be archived.");
          }
          const updated = await tx.focusPlan.update({
            where: { id: planId },
            data: {
              status: "ARCHIVED",
              archivedAt: assertValidClock(now()),
              planVersion: { increment: 1 },
            },
            include: { items: { orderBy: [{ sequence: "asc" }, { id: "asc" }] } },
          }) as PlanRecord;
          await enqueuePlanProjection(tx, updated);
          return updated;
        });
        return planDto(archived);
      });
    },

    async startSession(userId, rawInput) {
      requireSessionDependencies();
      const input = validateStart(rawInput);
      return safely(async () => repository.transaction(async (tx) => {
        await repository.lockUser(tx, userId);
        const existing = await tx.focusSession.findUnique({
          where: {
            userId_idempotencyKey: {
              userId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        }) as { id: string; planId: string; planItemId: string; startedAt: Date | null } | null;

        if (existing) {
          if (existing.planId !== input.planId || existing.planItemId !== input.planItemId) {
            throw new FocusError("IDEMPOTENCY_CONFLICT", "Start key was already used for another plan item.");
          }
          const session = await ownedSession(tx, userId, existing.id);
          const key = focusEventKey("started", session.id, input.idempotencyKey);
          const prior = await findFocusEvent(tx, userId, key);
          if (!prior) {
            throw new FocusError("RECONCILIATION_REQUIRED", "The stored session is missing its start event.");
          }
          const idempotency = await ingestFocusEvent(tx, {
            eventType: "focus_session_started",
            userId,
            occurredAt: existing.startedAt ?? prior.occurredAt,
            source: input.source,
            idempotencyKey: key,
            lectureId: session.lectureId,
            focusSessionId: session.id,
            evidenceClass: "CLIENT_OBSERVED",
            payload: {},
          });
          const count = await completedCount(tx, userId, session.planItemId);
          return {
            session: sessionDto(session, assertValidClock(now()), count),
            idempotency,
          };
        }

        const plan = await ownedPlan(tx, userId, input.planId);
        if (plan.status !== "ACTIVE") {
          throw new FocusError("PLAN_ARCHIVED", "Archived Focus Plans cannot start sessions.");
        }
        const item = plan.items.find((candidate) => candidate.id === input.planItemId);
        if (!item) throw new FocusError("PLAN_ITEM_NOT_FOUND", "Focus Plan item was not found.");

        if (await countNonterminal(tx, userId) > 0) {
          throw new FocusError("ACTIVE_SESSION_EXISTS", "A solo Focus Session is already in progress.");
        }

        const priorCompletedCount = await completedCount(tx, userId, item.id);
        if (priorCompletedCount >= item.sessionCount) {
          throw new FocusError("PLANNED_SESSIONS_COMPLETE", "All planned sessions for this item are complete.");
        }
        if (!canTransitionFocusSession("CREATED", "ACTIVE")) {
          throw new FocusError("INVALID_SESSION_STATE", "A Focus Session cannot start from CREATED.");
        }
        const clock = assertValidClock(now());
        const session = await tx.focusSession.create({
          data: {
            userId,
            planId: plan.id,
            planItemId: item.id,
            lectureId: item.lectureId,
            status: "ACTIVE",
            startedAt: clock,
            plannedEndAt: new Date(clock.getTime() + item.focusDurationSeconds * 1_000),
            lastCheckpointAt: clock,
            activeSeconds: 0,
            pauseSeconds: 0,
            idempotencyKey: input.idempotencyKey,
          },
          include: { planItem: true },
        }) as SessionRecord;

        const key = focusEventKey("started", session.id, input.idempotencyKey);
        const idempotency = await ingestFocusEvent(tx, {
          eventType: "focus_session_started",
          userId,
          occurredAt: clock,
          source: input.source,
          idempotencyKey: key,
          lectureId: session.lectureId,
          focusSessionId: session.id,
          evidenceClass: "CLIENT_OBSERVED",
          payload: {},
        });
        if (idempotency !== "FIRST_SEEN") {
          throw new FocusError("RECONCILIATION_REQUIRED", "A new session unexpectedly replayed its start event.");
        }
        await enqueueSessionProjection(tx, session);
        return {
          session: sessionDto(session, clock, priorCompletedCount),
          idempotency: "FIRST_SEEN" as const,
        };
      }));
    },

    async pauseSession(userId, sessionId, rawInput) {
      requireSessionDependencies();
      const input = validateTransition(rawInput);
      return safely(async () => repository.transaction(async (tx) => {
        await repository.lockUser(tx, userId);
        const session = await ownedSession(tx, userId, sessionId);
        const clock = assertValidClock(now());
        const key = focusEventKey("paused", session.id, input.idempotencyKey);
        const prior = await findFocusEvent(tx, userId, key);
        if (prior) {
          const idempotency = await ingestFocusEvent(tx, {
            eventType: "focus_session_paused",
            userId,
            occurredAt: prior.occurredAt,
            source: input.source,
            idempotencyKey: key,
            lectureId: session.lectureId,
            focusSessionId: session.id,
            evidenceClass: "CLIENT_OBSERVED",
            payload: {},
          });
          return {
            session: await getSessionDto(tx, session, clock),
            idempotency,
          };
        }
        if (!canTransitionFocusSession(session.status, "PAUSED")) {
          throw new FocusError("INVALID_SESSION_STATE", "This Focus Session cannot be paused from its current state.");
        }

        const action = pauseFocusTimer(timerInput(session), clock);
        if (action.status === "RECONCILIATION_REQUIRED") {
          throw new FocusError("RECONCILIATION_REQUIRED", "Session timer needs reconciliation before it can be paused.");
        }
        if (action.status === "SESSION_READY_TO_COMPLETE") {
          const dto = await getSessionDto(tx, session, clock);
          throw new FocusError(
            "SESSION_READY_TO_COMPLETE",
            "The planned focus duration has elapsed; complete the session instead of pausing.",
            undefined,
            { session: dto },
          );
        }
        const updated = await tx.focusSession.update({
          where: { id: session.id },
          data: {
            status: "PAUSED",
            activeSeconds: action.activeSeconds as number,
            lastCheckpointAt: clock,
          },
          include: { planItem: true },
        }) as SessionRecord;
        const idempotency = await ingestFocusEvent(tx, {
          eventType: "focus_session_paused",
          userId,
          occurredAt: clock,
          source: input.source,
          idempotencyKey: key,
          lectureId: updated.lectureId,
          focusSessionId: updated.id,
          evidenceClass: "CLIENT_OBSERVED",
          payload: {},
        });
        await enqueueSessionProjection(tx, updated);
        return {
          session: await getSessionDto(tx, updated, clock),
          idempotency,
        };
      }));
    },

    async resumeSession(userId, sessionId, rawInput) {
      requireSessionDependencies();
      const input = validateTransition(rawInput);
      return safely(async () => repository.transaction(async (tx) => {
        await repository.lockUser(tx, userId);
        const session = await ownedSession(tx, userId, sessionId);
        const clock = assertValidClock(now());
        const key = focusEventKey("resumed", session.id, input.idempotencyKey);
        const prior = await findFocusEvent(tx, userId, key);
        if (prior) {
          const idempotency = await ingestFocusEvent(tx, {
            eventType: "focus_session_resumed",
            userId,
            occurredAt: prior.occurredAt,
            source: input.source,
            idempotencyKey: key,
            lectureId: session.lectureId,
            focusSessionId: session.id,
            evidenceClass: "CLIENT_OBSERVED",
            payload: {},
          });
          return {
            session: await getSessionDto(tx, session, clock),
            idempotency,
          };
        }
        if (!canTransitionFocusSession(session.status, "ACTIVE")) {
          throw new FocusError("INVALID_SESSION_STATE", "This Focus Session cannot be resumed from its current state.");
        }

        const action = resumeFocusTimer(timerInput(session), clock);
        if (action.status === "RECONCILIATION_REQUIRED") {
          throw new FocusError("RECONCILIATION_REQUIRED", "Session timer needs reconciliation before it can be resumed.");
        }
        const updated = await tx.focusSession.update({
          where: { id: session.id },
          data: {
            status: "ACTIVE",
            pauseSeconds: action.pauseSeconds as number,
            plannedEndAt: new Date(action.plannedEndAt as string | Date),
            lastCheckpointAt: clock,
          },
          include: { planItem: true },
        }) as SessionRecord;
        const idempotency = await ingestFocusEvent(tx, {
          eventType: "focus_session_resumed",
          userId,
          occurredAt: clock,
          source: input.source,
          idempotencyKey: key,
          lectureId: updated.lectureId,
          focusSessionId: updated.id,
          evidenceClass: "CLIENT_OBSERVED",
          payload: {},
        });
        await enqueueSessionProjection(tx, updated);
        return {
          session: await getSessionDto(tx, updated, clock),
          idempotency,
        };
      }));
    },

    async currentSession(userId): Promise<FocusCurrentSessionResult> {
      requireSessionDependencies();
      const clock = assertValidClock(now());
      return safely(async () => {
        const sessions = await repository.database.focusSession.findMany({
          where: { userId, status: { in: [...NONTERMINAL_STATES] } },
          include: { planItem: true },
          orderBy: [{ startedAt: "desc" }, { id: "asc" }],
          take: 2,
        }) as SessionRecord[];
        if (sessions.length > 1) {
          throw new FocusError(
            "RECONCILIATION_REQUIRED",
            "More than one nonterminal solo session exists for this user.",
          );
        }
        if (!sessions.length) return { session: null, serverNow: clock.toISOString() };
        const session = sessions[0];
        const count = await repository.database.focusSession.count({
          where: { userId, planItemId: session.planItemId, status: "COMPLETED" },
        });
        return {
          session: sessionDto(session, clock, count),
          serverNow: clock.toISOString(),
        };
      });
    },

    async completeSession(userId, sessionId, rawInput) {
      requireSessionDependencies();
      const input = validateComplete(rawInput);
      return safely(async () => repository.transaction(async (tx) => {
        await repository.lockUser(tx, userId);
        const session = await ownedSession(tx, userId, sessionId);
        const clock = assertValidClock(now());
        const key = focusEventKey("completed", session.id, input.idempotencyKey);
        const prior = await findFocusEvent(tx, userId, key);

        if (prior) {
          if (session.status !== "COMPLETED") {
            throw new FocusError(
              "RECONCILIATION_REQUIRED",
              "Completion event exists but the Focus Session is not completed.",
            );
          }
          const idempotency = await ingestFocusEvent(tx, {
            eventType: "focus_session_completed",
            userId,
            occurredAt: prior.occurredAt,
            source: "backend",
            idempotencyKey: key,
            lectureId: session.lectureId,
            focusSessionId: session.id,
            evidenceClass: "SERVER_VALIDATED",
            payload: {
              activeSeconds: session.activeSeconds,
              pauseSeconds: session.pauseSeconds,
              completionReason: session.completionReason ?? "PLANNED_DURATION_ELAPSED",
            },
          });
          const count = await completedCount(tx, userId, session.planItemId);
          const dto = sessionDto(session, clock, count);
          return {
            session: dto,
            idempotency,
            manualLectureCompletionRequired: dto.isLastPlannedSession,
            followUpPreferences: {
              includeMcq: session.planItem.includeMcq,
              includeFlashcards: session.planItem.includeFlashcards,
              includeVideo: session.planItem.includeVideo,
            },
          };
        }

        if (session.status === "RECONCILIATION_REQUIRED") {
          throw new FocusError(
            "RECONCILIATION_REQUIRED",
            "Ordinary completion cannot resolve a session that requires reconciliation.",
          );
        }
        if (!canTransitionFocusSession(session.status, "COMPLETED")) {
          throw new FocusError("INVALID_SESSION_STATE", "This Focus Session cannot be completed from its current state.");
        }
        const action = completeFocusTimer(timerInput(session), clock);
        if (action.status === "INVALID_SESSION_STATE") {
          throw new FocusError("INVALID_SESSION_STATE", "Only an active session can be completed.");
        }
        if (action.status === "RECONCILIATION_REQUIRED") {
          throw new FocusError("RECONCILIATION_REQUIRED", "Session timer needs reconciliation before completion.");
        }
        if (action.status === "SESSION_NOT_READY") {
          const dto = await getSessionDto(tx, session, clock);
          throw new FocusError(
            "SESSION_NOT_READY_TO_COMPLETE",
            "The server-calculated focus duration has not elapsed.",
            undefined,
            { session: dto },
          );
        }
        const activeSeconds = action.activeSeconds;
        if (!Number.isSafeInteger(activeSeconds) || (activeSeconds as number) < 0) {
          throw new FocusError("RECONCILIATION_REQUIRED", "Session active-time calculation is invalid.");
        }
        const completionReason = "PLANNED_DURATION_ELAPSED";
        const updated = await tx.focusSession.update({
          where: { id: session.id },
          data: {
            status: "COMPLETED",
            actualEndedAt: clock,
            lastCheckpointAt: clock,
            activeSeconds: activeSeconds as number,
            completionReason,
          },
          include: { planItem: true },
        }) as SessionRecord;
        const idempotency = await ingestFocusEvent(tx, {
          eventType: "focus_session_completed",
          userId,
          occurredAt: clock,
          source: "backend",
          idempotencyKey: key,
          lectureId: updated.lectureId,
          focusSessionId: updated.id,
          evidenceClass: "SERVER_VALIDATED",
          payload: {
            activeSeconds: activeSeconds as number,
            pauseSeconds: updated.pauseSeconds,
            completionReason,
          },
        });
        if (idempotency !== "FIRST_SEEN") {
          throw new FocusError("RECONCILIATION_REQUIRED", "A new completion unexpectedly replayed its event.");
        }
        await enqueueSessionProjection(tx, updated);
        const count = await completedCount(tx, userId, updated.planItemId);
        const dto = sessionDto(updated, clock, count);
        return {
          session: dto,
          idempotency,
          manualLectureCompletionRequired: dto.isLastPlannedSession,
          followUpPreferences: {
            includeMcq: updated.planItem.includeMcq,
            includeFlashcards: updated.planItem.includeFlashcards,
            includeVideo: updated.planItem.includeVideo,
          },
        };
      }));
    },

    async abandonSession(userId, sessionId, rawInput) {
      requireSessionDependencies();
      const input = validateAbandon(rawInput);
      const reason = input.reason ?? "USER_ABANDONED";
      return safely(async () => repository.transaction(async (tx) => {
        await repository.lockUser(tx, userId);
        const session = await ownedSession(tx, userId, sessionId);
        const clock = assertValidClock(now());
        const key = focusEventKey("abandoned", session.id, input.idempotencyKey);
        const prior = await findFocusEvent(tx, userId, key);
        if (prior) {
          const idempotency = await ingestFocusEvent(tx, {
            eventType: "focus_session_abandoned",
            userId,
            occurredAt: prior.occurredAt,
            source: "backend",
            idempotencyKey: key,
            lectureId: session.lectureId,
            focusSessionId: session.id,
            evidenceClass: "SERVER_VALIDATED",
            payload: { reason },
          });
          return {
            session: await getSessionDto(tx, session, clock),
            idempotency,
          };
        }

        if (!canTransitionFocusSession(session.status, "ABANDONED")) {
          throw new FocusError("INVALID_SESSION_STATE", "This Focus Session cannot be abandoned.");
        }
        const action = abandonFocusTimer(timerInput(session), clock);
        // A stale/corrupt active segment is not credited. Previously persisted
        // activeSeconds only contains time that was already checkpointed.
        const activeSeconds = action.reconciliationRequired
          ? session.activeSeconds
          : action.activeSeconds;
        if (!Number.isSafeInteger(activeSeconds) || (activeSeconds as number) < 0) {
          throw new FocusError("RECONCILIATION_REQUIRED", "Session active-time calculation is invalid.");
        }
        const updated = await tx.focusSession.update({
          where: { id: session.id },
          data: {
            status: "ABANDONED",
            actualEndedAt: clock,
            lastCheckpointAt: clock,
            activeSeconds: activeSeconds as number,
            completionReason: reason,
          },
          include: { planItem: true },
        }) as SessionRecord;
        const idempotency = await ingestFocusEvent(tx, {
          eventType: "focus_session_abandoned",
          userId,
          occurredAt: clock,
          source: "backend",
          idempotencyKey: key,
          lectureId: updated.lectureId,
          focusSessionId: updated.id,
          evidenceClass: "SERVER_VALIDATED",
          payload: { reason },
        });
        if (idempotency !== "FIRST_SEEN") {
          throw new FocusError("RECONCILIATION_REQUIRED", "A new abandonment unexpectedly replayed its event.");
        }
        await enqueueSessionProjection(tx, updated);
        return {
          session: await getSessionDto(tx, updated, clock),
          idempotency,
        };
      }));
    },
  };
}