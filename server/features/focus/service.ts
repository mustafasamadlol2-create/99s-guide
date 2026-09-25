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
  resourceHandoffStartSchema,
  resourceHandoffReturnSchema,
  interruptionRecordSchema,
  type ResourceHandoffStartInput,
  type ResourceHandoffReturnInput,
  type InterruptionRecordInput,
  createFocusQuickNoteSchema,
  updateFocusQuickNoteSchema,
  focusQuickNoteListQuerySchema,
  convertFocusQuickNoteSchema,
  focusMetricsQuerySchema,
  type CreateFocusQuickNoteInput,
  type UpdateFocusQuickNoteInput,
  type FocusQuickNoteListQuery,
  type ConvertFocusQuickNoteInput,
  type FocusMetricsPeriod,
} from "./schemas.js";
import { FocusRepository, type FocusTransaction } from "./repository.js";
import type { StudyEventRecord } from "../study-events/types.js";
import { ingestStudyEvent } from "../study-events/service.js";
import { enqueuePrivateD1Projection } from "../../services/privateD1Sync.js";
import {
  fetchFocusPlanProjections,
  fetchStudyDailyMetricProjections,
  logPrivateReadFallback,
  privateReadEnabled,
  type FocusPlanReadProjection,
} from "../../services/privateD1Read.js";
import type { StudyDailyMetricProjection } from "../study-core/projection.js";
import type {
  FocusBackendService,
  FocusCurrentSessionResult,
  FocusPlanDto,
  FocusPlanItemDto,
  FocusSessionDto,
  FocusSessionMutationResult,
  FocusInterruptionResult,
  FocusQuickNoteDto,
  FocusQuickNoteCreateResult,
  FocusQuickNoteConversionResult,
  FocusMetricsDto,
  FocusMetricCounters,
  FocusMetricsDaily,
  PostFocusActionContext,
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

type FocusEventOperation =
  | "started" | "paused" | "resumed" | "completed" | "abandoned"
  | "handoff_started" | "handoff_returned" | "interruption";

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
  d1MetricReadsEnabled?: () => boolean;
  fetchMetricsFromD1?: (
    userId: string,
    options: { from?: string; to?: string; limit?: number },
  ) => Promise<StudyDailyMetricProjection[]>;
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

async function findLatestHandoffStart(
  tx: FocusTransaction,
  userId: string,
  sessionId: string,
): Promise<StudyEventRecord | null> {
  return await tx.studyEvent.findFirst({
    where: {
      userId,
      focusSessionId: sessionId,
      eventType: "focus_resource_handoff_started",
    },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
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

const BAGHDAD_TIMEZONE = "Asia/Baghdad" as const;
const ALL_METRIC_FIELDS = [
  "focusSeconds",
  "sessionsCompleted",
  "mcqAttempts",
  "mcqCorrect",
  "flashcardReviews",
  "recallAttempts",
  "recallCorrect",
  "lectureCompletions",
  "interruptionCount",
] as const;
const NOTE_CREATABLE_SESSION_STATES = new Set([
  "ACTIVE",
  "PAUSED",
  "RESOURCE_HANDOFF",
  "COMPLETED",
  "ABANDONED",
]);

type QuickNoteRecord = {
  id: string;
  userId: string;
  focusSessionId: string;
  lectureId: string;
  content: string;
  status: string;
  convertedToPlanItemId: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  convertedAt: Date | null;
};

type MetricRow = {
  metricDate: Date | string;
  focusSeconds: number;
  sessionsCompleted: number;
  interruptionCount: number;
};

function quickNoteDto(note: QuickNoteRecord): FocusQuickNoteDto {
  if (!["ACTIVE", "ARCHIVED", "CONVERTED"].includes(note.status)) {
    throw new FocusError("RECONCILIATION_REQUIRED", "Quick Note has an unsupported stored status.");
  }
  return {
    id: note.id,
    focusSessionId: note.focusSessionId,
    lectureId: note.lectureId,
    content: note.content,
    status: note.status as FocusQuickNoteDto["status"],
    convertedToPlanItemId: note.convertedToPlanItemId,
    createdAt: iso(note.createdAt) as string,
    updatedAt: iso(note.updatedAt) as string,
    archivedAt: iso(note.archivedAt),
    convertedAt: iso(note.convertedAt),
  };
}

function metricDateString(value: Date | string): string {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error("Metric date is invalid.");
    return value.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error("Metric date is invalid.");
  return value;
}

function isLogicalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function shiftLogicalDate(date: string, offset: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + offset));
  return shifted.toISOString().slice(0, 10);
}

export function getBaghdadFocusMetricRange(
  period: FocusMetricsPeriod,
  now: Date,
): { startDate: string; endDate: string } {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new FocusError("RECONCILIATION_REQUIRED", "Server clock returned an invalid timestamp.");
  }
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: BAGHDAD_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((value) => value.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) {
    throw new FocusError("RECONCILIATION_REQUIRED", "Baghdad logical date could not be calculated.");
  }
  const today = `${year}-${month}-${day}`;
  if (period === "today") return { startDate: today, endDate: today };
  if (period === "last7Days") return { startDate: shiftLogicalDate(today, -6), endDate: today };
  return { startDate: `${year}-${month}-01`, endDate: today };
}

function isValidMetricProjection(
  row: StudyDailyMetricProjection,
  userId: string,
  startDate: string,
  endDate: string,
): boolean {
  const revision = String(row.revision);
  return typeof row.id === "string" &&
    row.id === row.canonicalId &&
    Number.isSafeInteger(row.projectionVersion) &&
    row.projectionVersion > 0 &&
    /^\d+$/u.test(revision) &&
    typeof row.updatedAt === "string" &&
    Number.isFinite(Date.parse(row.updatedAt)) &&
    row.userId === userId &&
    row.userScope === userId &&
    row.deletedAt === null &&
    isLogicalDate(row.metricDate) &&
    row.metricDate >= startDate &&
    row.metricDate <= endDate &&
    ALL_METRIC_FIELDS.every((field) =>
      Number.isSafeInteger(row[field]) && row[field] >= 0
    );
}

function metricCounters(row?: MetricRow): FocusMetricCounters {
  return {
    focusSeconds: row?.focusSeconds ?? 0,
    sessionsCompleted: row?.sessionsCompleted ?? 0,
    interruptionCount: row?.interruptionCount ?? 0,
  };
}

function buildFocusMetrics(
  period: FocusMetricsPeriod,
  range: { startDate: string; endDate: string },
  rows: MetricRow[],
): FocusMetricsDto {
  const byDate = new Map<string, MetricRow>();
  for (const row of rows) {
    const date = metricDateString(row.metricDate);
    if (date < range.startDate || date > range.endDate || byDate.has(date)) {
      throw new Error("Metric rows contain an invalid or duplicate logical date.");
    }
    byDate.set(date, row);
  }
  const daily: FocusMetricsDaily[] = [];
  for (
    let date = range.startDate;
    date <= range.endDate;
    date = shiftLogicalDate(date, 1)
  ) {
    daily.push({ date, ...metricCounters(byDate.get(date)) });
  }
  const totals = daily.reduce<FocusMetricCounters>((sum, row) => ({
    focusSeconds: sum.focusSeconds + row.focusSeconds,
    sessionsCompleted: sum.sessionsCompleted + row.sessionsCompleted,
    interruptionCount: sum.interruptionCount + row.interruptionCount,
  }), { focusSeconds: 0, sessionsCompleted: 0, interruptionCount: 0 });
  return {
    period,
    timezone: BAGHDAD_TIMEZONE,
    startDate: range.startDate,
    endDate: range.endDate,
    totals,
    daily,
  };
}

export function buildPostFocusActionContext(input: {
  session: {
    id: string;
    lectureId: string;
    planId: string;
    planItemId: string;
    planItem: PlanItemRecord;
  };
  completedCount: number;
  available: { mcq: boolean; flashcards: boolean; video: boolean };
}): PostFocusActionContext {
  const { session, completedCount, available } = input;
  const sessionNumber = completedCount;
  const isLastPlannedSession = sessionNumber >= session.planItem.sessionCount;
  return {
    sessionId: session.id,
    lectureId: session.lectureId,
    planId: session.planId,
    planItemId: session.planItemId,
    sessionNumber,
    plannedSessionCount: session.planItem.sessionCount,
    isLastPlannedSession,
    manualLectureCompletionRequired: isLastPlannedSession,
    configured: {
      mcq: session.planItem.includeMcq,
      flashcards: session.planItem.includeFlashcards,
      video: session.planItem.includeVideo,
    },
    available,
  };
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
  const d1MetricReadsEnabled = options.d1MetricReadsEnabled ??
    (() => privateReadEnabled("PRIVATE_D1_STUDY_DAILY_METRIC_READS_ENABLED"));
  const fetchMetricsFromD1 = options.fetchMetricsFromD1 ?? fetchStudyDailyMetricProjections;

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

  function validateHandoffStart(input: ResourceHandoffStartInput): ResourceHandoffStartInput {
    const parsed = resourceHandoffStartSchema.safeParse(input);
    if (!parsed.success) throw requestInputError("Resource handoff start request is invalid.");
    return parsed.data;
  }

  function validateHandoffReturn(input: ResourceHandoffReturnInput): ResourceHandoffReturnInput {
    const parsed = resourceHandoffReturnSchema.safeParse(input);
    if (!parsed.success) throw requestInputError("Resource handoff return request is invalid.");
    return parsed.data;
  }

  function validateInterruption(input: InterruptionRecordInput): InterruptionRecordInput {
    const parsed = interruptionRecordSchema.safeParse(input);
    if (!parsed.success) throw requestInputError("Focus interruption request is invalid.");
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
              const convertedNote = await tx.focusQuickNote.findFirst({
                where: { convertedToPlanItemId: { in: removed.map((item) => item.id) } },
                select: { id: true },
              });
              if (convertedNote) {
                throw new FocusError(
                  "PLAN_ITEM_HAS_QUICK_NOTE_CONVERSION",
                  "A Focus Plan item created from a Quick Note cannot be removed.",
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

    async startResourceHandoff(userId, sessionId, rawInput) {
      requireSessionDependencies();
      const input = validateHandoffStart(rawInput);
      return safely(async () => repository.transaction(async (tx) => {
        await repository.lockUser(tx, userId);
        const session = await ownedSession(tx, userId, sessionId);
        const clock = assertValidClock(now());
        const key = focusEventKey("handoff_started", session.id, input.idempotencyKey);
        const prior = await findFocusEvent(tx, userId, key);
        if (prior) {
          const payload = prior.payload as Record<string, unknown>;
          if (payload.resourceId !== input.resourceId ||
              String(payload.resourceType).toUpperCase() !== input.resourceType) {
            throw new FocusError("IDEMPOTENCY_CONFLICT", "Handoff key was used for another resource.");
          }
          const idempotency = await ingestFocusEvent(tx, {
            eventType: "focus_resource_handoff_started", userId,
            occurredAt: prior.occurredAt, source: input.source, idempotencyKey: key,
            lectureId: session.lectureId, focusSessionId: session.id,
            evidenceClass: "CLIENT_OBSERVED", payload,
          });
          return { session: await getSessionDto(tx, session, clock), idempotency };
        }
        const material = await tx.material.findFirst({
          where: { id: input.resourceId, lectureId: session.lectureId },
          select: { id: true, type: true },
        }) as { id: string; type: string } | null;
        if (!material) throw new FocusError("RESOURCE_NOT_FOUND", "Focus resource was not found.");
        if (!["PDF", "VIDEO"].includes(material.type.trim().toUpperCase()) ||
            material.type.trim().toUpperCase() !== input.resourceType) {
          throw new FocusError("UNSUPPORTED_RESOURCE_TYPE", "This Focus resource type is not supported.");
        }
        if (session.status !== "ACTIVE") {
          throw new FocusError("INVALID_SESSION_STATE", "Resource handoff can only start from an active session.");
        }
        const action = buildFocusTimerSnapshot({ session: timerInput(session), now: clock });
        if (action.reconciliationRequired || action.elapsedActiveSeconds === null) {
          throw new FocusError("RECONCILIATION_REQUIRED", "Session timer needs reconciliation before handoff.");
        }
        const updated = await tx.focusSession.update({
          where: { id: session.id },
          data: {
            status: "RESOURCE_HANDOFF",
            activeSeconds: action.elapsedActiveSeconds,
            lastCheckpointAt: clock,
          },
          include: { planItem: true },
        }) as SessionRecord;
        const idempotency = await ingestFocusEvent(tx, {
          eventType: "focus_resource_handoff_started", userId, occurredAt: clock,
          source: input.source, idempotencyKey: key, lectureId: updated.lectureId,
          focusSessionId: updated.id, evidenceClass: "CLIENT_OBSERVED",
          payload: { resourceType: input.resourceType, resourceId: material.id, status: "STARTED" },
        });
        if (idempotency !== "FIRST_SEEN") throw new FocusError("RECONCILIATION_REQUIRED", "Handoff event unexpectedly replayed.");
        await enqueueSessionProjection(tx, updated);
        return { session: await getSessionDto(tx, updated, clock), idempotency };
      }));
    },

    async returnFromResourceHandoff(userId, sessionId, rawInput) {
      requireSessionDependencies();
      const input = validateHandoffReturn(rawInput);
      return safely(async () => repository.transaction(async (tx) => {
        await repository.lockUser(tx, userId);
        const session = await ownedSession(tx, userId, sessionId);
        const clock = assertValidClock(now());
        const key = focusEventKey("handoff_returned", session.id, input.idempotencyKey);
        const prior = await findFocusEvent(tx, userId, key);
        if (prior) {
          const payload = prior.payload as Record<string, unknown>;
          const idempotency = await ingestFocusEvent(tx, {
            eventType: "focus_resource_handoff_returned", userId,
            occurredAt: prior.occurredAt, source: input.source, idempotencyKey: key,
            lectureId: session.lectureId, focusSessionId: session.id,
            evidenceClass: "CLIENT_OBSERVED",
            payload,
          });
          return { session: await getSessionDto(tx, session, clock), idempotency };
        }
        if (session.status !== "RESOURCE_HANDOFF") {
          throw new FocusError("INVALID_SESSION_STATE", "This Focus Session is not in resource handoff.");
        }
        const started = await findLatestHandoffStart(tx, userId, session.id);
        const startedPayload = started?.payload as Record<string, unknown> | undefined;
        if (!startedPayload?.resourceType || !startedPayload.resourceId) {
          throw new FocusError("RECONCILIATION_REQUIRED", "Handoff start history is missing.");
        }
        const timer = buildFocusTimerSnapshot({ session: timerInput(session), now: clock });
        if (timer.reconciliationRequired || timer.elapsedActiveSeconds === null) {
          throw new FocusError("RECONCILIATION_REQUIRED", "Session timer needs reconciliation before return.");
        }
        const updated = await tx.focusSession.update({
          where: { id: session.id },
          data: {
            status: "ACTIVE",
            activeSeconds: timer.elapsedActiveSeconds,
            lastCheckpointAt: clock,
          },
          include: { planItem: true },
        }) as SessionRecord;
        const idempotency = await ingestFocusEvent(tx, {
          eventType: "focus_resource_handoff_returned", userId, occurredAt: clock,
          source: input.source, idempotencyKey: key, lectureId: updated.lectureId,
          focusSessionId: updated.id, evidenceClass: "CLIENT_OBSERVED",
          payload: {
            resourceType: String(startedPayload.resourceType),
            resourceId: String(startedPayload.resourceId),
            status: "RETURNED",
          },
        });
        if (idempotency !== "FIRST_SEEN") throw new FocusError("RECONCILIATION_REQUIRED", "Return event unexpectedly replayed.");
        await enqueueSessionProjection(tx, updated);
        return { session: await getSessionDto(tx, updated, clock), idempotency };
      }));
    },

    async recordInterruption(userId, sessionId, rawInput): Promise<FocusInterruptionResult> {
      requireSessionDependencies();
      const input = validateInterruption(rawInput);
      return safely(async () => repository.transaction(async (tx) => {
        await repository.lockUser(tx, userId);
        const session = await ownedSession(tx, userId, sessionId);
        const clock = assertValidClock(now());
        const key = focusEventKey("interruption", session.id, input.idempotencyKey);
        const prior = await findFocusEvent(tx, userId, key);
        if (prior) {
          const payload = prior.payload as Record<string, unknown>;
          if (
            payload.reason !== input.reason ||
            payload.durationSeconds !== input.observedAwaySeconds
          ) {
            throw new FocusError(
              "IDEMPOTENCY_CONFLICT",
              "Interruption key was already used for different details.",
            );
          }
          const result = await ingestFocusEvent(tx, {
            eventType: "focus_interruption_recorded", userId,
            occurredAt: prior.occurredAt, source: "backend", idempotencyKey: key,
            lectureId: session.lectureId, focusSessionId: session.id,
            evidenceClass: "SERVER_VALIDATED", payload,
          });
          return { idempotency: result, metricUpdated: false };
        }
        if (session.status === "RESOURCE_HANDOFF") {
          throw new FocusError("HANDOFF_SUPPRESSES_INTERRUPTION", "Resource handoff suppresses interruption recording.");
        }
        if (session.status !== "ACTIVE") {
          throw new FocusError("INVALID_SESSION_STATE", "Interruption recording requires an active session.");
        }
        const result = await ingestFocusEvent(tx, {
          eventType: "focus_interruption_recorded", userId, occurredAt: clock,
          source: "backend", idempotencyKey: key, lectureId: session.lectureId,
          focusSessionId: session.id, evidenceClass: "SERVER_VALIDATED",
          payload: { reason: input.reason, durationSeconds: input.observedAwaySeconds },
        });
        return { idempotency: result, metricUpdated: result === "FIRST_SEEN" };
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

    async createQuickNote(userId, rawInput): Promise<FocusQuickNoteCreateResult> {
      requireFocus();
      const parsed = createFocusQuickNoteSchema.safeParse(rawInput);
      if (!parsed.success) throw requestInputError("Quick Note request is invalid.");
      const input: CreateFocusQuickNoteInput = parsed.data;
      return safely(async () => {
        const result = await repository.transaction(async (tx) => {
          await repository.lockUser(tx, userId);
          const existing = await tx.focusQuickNote.findUnique({
            where: {
              userId_idempotencyKey: {
                userId,
                idempotencyKey: input.idempotencyKey,
              },
            },
          }) as QuickNoteRecord | null;
          if (existing) {
            if (existing.focusSessionId !== input.focusSessionId || existing.content !== input.content) {
              throw new FocusError("IDEMPOTENCY_CONFLICT", "Quick Note key was already used for different content.");
            }
            return { note: existing, idempotency: "REPLAY_SAME_PAYLOAD" as const };
          }

          const session = await tx.focusSession.findFirst({
            where: { id: input.focusSessionId, userId },
            select: { id: true, lectureId: true, status: true },
          }) as { id: string; lectureId: string; status: string } | null;
          if (!session) {
            throw new FocusError("SESSION_NOT_FOUND", "Focus Session was not found.");
          }
          if (!NOTE_CREATABLE_SESSION_STATES.has(session.status)) {
            throw new FocusError(
              "INVALID_SESSION_STATE",
              "Quick Notes require an initialized, non-expired Focus Session.",
            );
          }
          const note = await tx.focusQuickNote.create({
            data: {
              userId,
              focusSessionId: session.id,
              lectureId: session.lectureId,
              content: input.content,
              idempotencyKey: input.idempotencyKey,
              status: "ACTIVE",
            },
          }) as QuickNoteRecord;
          return { note, idempotency: "CREATED" as const };
        });
        return { note: quickNoteDto(result.note), idempotency: result.idempotency };
      });
    },

    async listQuickNotes(userId, rawQuery = {}): Promise<FocusQuickNoteDto[]> {
      requireFocus();
      const parsed = focusQuickNoteListQuerySchema.safeParse(rawQuery);
      if (!parsed.success) throw requestInputError("Quick Note query is invalid.");
      return safely(async () => {
        const rows = await repository.database.focusQuickNote.findMany({
          where: {
            userId,
            ...(parsed.data.sessionId ? { focusSessionId: parsed.data.sessionId } : {}),
            ...(parsed.data.lectureId ? { lectureId: parsed.data.lectureId } : {}),
            // Keep the default collection useful while archived notes remain
            // retrievable through an explicit status filter or the detail route.
            status: parsed.data.status ?? "ACTIVE",
          },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: parsed.data.limit ?? 50,
        }) as QuickNoteRecord[];
        return rows.map(quickNoteDto);
      });
    },

    async getQuickNote(userId, noteId): Promise<FocusQuickNoteDto> {
      requireFocus();
      return safely(async () => {
        const note = await repository.database.focusQuickNote.findFirst({
          where: { id: noteId, userId },
        }) as QuickNoteRecord | null;
        if (!note) throw new FocusError("QUICK_NOTE_NOT_FOUND", "Quick Note was not found.");
        return quickNoteDto(note);
      });
    },

    async updateQuickNote(userId, noteId, rawInput): Promise<FocusQuickNoteDto> {
      requireFocus();
      const parsed = updateFocusQuickNoteSchema.safeParse(rawInput);
      if (!parsed.success) throw requestInputError("Quick Note update is invalid.");
      const input: UpdateFocusQuickNoteInput = parsed.data;
      return safely(async () => {
        const note = await repository.transaction(async (tx) => {
          await repository.lockUser(tx, userId);
          const current = await tx.focusQuickNote.findFirst({
            where: { id: noteId, userId },
          }) as QuickNoteRecord | null;
          if (!current) throw new FocusError("QUICK_NOTE_NOT_FOUND", "Quick Note was not found.");
          if (current.status === "ARCHIVED") {
            throw new FocusError("QUICK_NOTE_ARCHIVED", "Archived Quick Notes cannot be edited.");
          }
          return await tx.focusQuickNote.update({
            where: { id: current.id },
            data: { content: input.content },
          }) as QuickNoteRecord;
        });
        return quickNoteDto(note);
      });
    },

    async archiveQuickNote(userId, noteId): Promise<FocusQuickNoteDto> {
      requireFocus();
      return safely(async () => {
        const note = await repository.transaction(async (tx) => {
          await repository.lockUser(tx, userId);
          const current = await tx.focusQuickNote.findFirst({
            where: { id: noteId, userId },
          }) as QuickNoteRecord | null;
          if (!current) throw new FocusError("QUICK_NOTE_NOT_FOUND", "Quick Note was not found.");
          if (current.status === "ARCHIVED") return current;
          return await tx.focusQuickNote.update({
            where: { id: current.id },
            data: {
              status: "ARCHIVED",
              archivedAt: assertValidClock(now()),
            },
          }) as QuickNoteRecord;
        });
        return quickNoteDto(note);
      });
    },

    async convertQuickNote(userId, noteId, rawInput): Promise<FocusQuickNoteConversionResult> {
      requireFocus();
      const parsed = convertFocusQuickNoteSchema.safeParse(rawInput);
      if (!parsed.success) throw requestInputError("Quick Note conversion request is invalid.");
      const input: ConvertFocusQuickNoteInput = parsed.data;
      return safely(async () => repository.transaction(async (tx) => {
        await repository.lockUser(tx, userId);
        const note = await tx.focusQuickNote.findFirst({
          where: { id: noteId, userId },
          include: {
            focusSession: { include: { planItem: true } },
            convertedToPlanItem: true,
          },
        }) as (QuickNoteRecord & {
          focusSession: { planItem: PlanItemRecord };
          convertedToPlanItem: (PlanItemRecord & { planId: string }) | null;
        }) | null;
        if (!note) throw new FocusError("QUICK_NOTE_NOT_FOUND", "Quick Note was not found.");

        if (note.convertedToPlanItemId) {
          const convertedItem = note.convertedToPlanItem;
          if (!convertedItem) {
            throw new FocusError("RECONCILIATION_REQUIRED", "Quick Note conversion link is missing.");
          }
          if (convertedItem.planId !== input.targetPlanId) {
            throw new FocusError(
              "QUICK_NOTE_CONVERSION_CONFLICT",
              "Quick Note was already converted to a different Focus Plan.",
            );
          }
          return {
            note: quickNoteDto(note),
            planItem: { ...planItemDto(convertedItem), planId: convertedItem.planId },
            idempotency: "REPLAY_SAME_PAYLOAD" as const,
          };
        }
        if (note.status === "ARCHIVED") {
          throw new FocusError("QUICK_NOTE_ARCHIVED", "Archived Quick Notes cannot be converted.");
        }
        if (note.status !== "ACTIVE") {
          throw new FocusError("RECONCILIATION_REQUIRED", "Quick Note conversion state is inconsistent.");
        }

        const plan = await ownedPlan(tx, userId, input.targetPlanId);
        if (plan.status !== "ACTIVE") {
          throw new FocusError("PLAN_ARCHIVED", "Archived Focus Plans cannot receive Quick Note conversions.");
        }
        if (await countNonterminal(tx, userId, plan.id) > 0) {
          throw new FocusError(
            "PLAN_HAS_ACTIVE_SESSION",
            "A Focus Plan with a nonterminal Session cannot be structurally edited.",
          );
        }
        const nextSequence = Math.max(0, ...plan.items.map((item) => item.sequence)) + 1;
        if (plan.items.length >= 100 || nextSequence > 100) {
          throw new FocusError("PLAN_ITEM_LIMIT_REACHED", "This Focus Plan cannot accept another item.");
        }

        const source = note.focusSession.planItem;
        const item = await tx.focusPlanItem.create({
          data: {
            planId: plan.id,
            lectureId: note.lectureId,
            sequence: nextSequence,
            sessionCount: 1,
            focusDurationSeconds: source.focusDurationSeconds,
            breakDurationSeconds: source.breakDurationSeconds,
            includeMcq: source.includeMcq,
            includeFlashcards: source.includeFlashcards,
            includeVideo: source.includeVideo,
          },
        }) as PlanItemRecord & { planId: string };

        const convertedAt = assertValidClock(now());
        const updatedNote = await tx.focusQuickNote.update({
          where: { id: note.id },
          data: {
            status: "CONVERTED",
            convertedToPlanItemId: item.id,
            convertedAt,
          },
        }) as QuickNoteRecord;
        const updatedPlan = await tx.focusPlan.update({
          where: { id: plan.id },
          data: { planVersion: { increment: 1 } },
          include: { items: { orderBy: [{ sequence: "asc" }, { id: "asc" }] } },
        }) as PlanRecord;
        await enqueuePlanProjection(tx, updatedPlan);
        return {
          note: quickNoteDto(updatedNote),
          planItem: { ...planItemDto(item), planId: item.planId },
          idempotency: "CONVERTED" as const,
        };
      }));
    },

    async getMetrics(userId, rawPeriod): Promise<FocusMetricsDto> {
      requireFocus();
      const parsed = focusMetricsQuerySchema.safeParse({ period: rawPeriod });
      if (!parsed.success) throw requestInputError("Focus metrics period is invalid.");
      const period: FocusMetricsPeriod = parsed.data.period;
      const clock = assertValidClock(now());
      const range = getBaghdadFocusMetricRange(period, clock);
      return safely(async () => {
        let rows: MetricRow[] | undefined;
        if (d1MetricReadsEnabled()) {
          try {
            const projected = await fetchMetricsFromD1(userId, {
              from: range.startDate,
              to: range.endDate,
              limit: period === "today" ? 1 : period === "last7Days" ? 7 : 31,
            });
            if (
              !Array.isArray(projected) ||
              projected.length > (period === "today" ? 1 : period === "last7Days" ? 7 : 31) ||
              projected.some((row) => !isValidMetricProjection(row, userId, range.startDate, range.endDate))
            ) {
              throw new Error("Private Study Daily Metric projection is malformed or out of scope.");
            }
            rows = projected.map((row) => ({
              metricDate: row.metricDate,
              focusSeconds: row.focusSeconds,
              sessionsCompleted: row.sessionsCompleted,
              interruptionCount: row.interruptionCount,
            }));
          } catch (error) {
            logPrivateReadFallback("Focus metrics projection read", error);
          }
        }
        if (!rows) {
          rows = await repository.database.studyDailyMetric.findMany({
            where: {
              userId,
              metricDate: {
                gte: new Date(`${range.startDate}T00:00:00.000Z`),
                lte: new Date(`${range.endDate}T00:00:00.000Z`),
              },
            },
            select: {
              metricDate: true,
              focusSeconds: true,
              sessionsCompleted: true,
              interruptionCount: true,
            },
            orderBy: { metricDate: "asc" },
          }) as MetricRow[];
        }
        return buildFocusMetrics(period, range, rows);
      });
    },

    async getPostFocusActionContext(userId, sessionId): Promise<PostFocusActionContext> {
      requireFocus();
      return safely(async () => repository.database.$transaction(async (tx) => {
        const session = await tx.focusSession.findFirst({
          where: { id: sessionId, userId },
          include: { planItem: true },
        }) as (SessionRecord & { planItem: PlanItemRecord }) | null;
        if (!session) throw new FocusError("SESSION_NOT_FOUND", "Focus Session was not found.");
        if (session.status !== "COMPLETED") {
          throw new FocusError(
            "INVALID_SESSION_STATE",
            "Post-Focus actions are available only for completed Sessions.",
          );
        }
        const [completedCountForItem, mcq, flashcard, materials] = await Promise.all([
          tx.focusSession.count({
            where: { userId, planItemId: session.planItemId, status: "COMPLETED" },
          }),
          // Existing application semantics treat the presence of at least one
          // canonical MCQ row as a usable MCQ action.
          tx.mcq.findFirst({
            where: { lectureId: session.lectureId },
            select: { id: true },
          }),
          tx.flashcard.findFirst({
            where: { lectureId: session.lectureId },
            select: { id: true },
          }),
          tx.material.findMany({
            where: { lectureId: session.lectureId },
            select: { type: true },
          }),
        ]);
        return buildPostFocusActionContext({
          session,
          completedCount: completedCountForItem,
          available: {
            mcq: mcq !== null,
            flashcards: flashcard !== null,
            video: materials.some((material) => material.type.trim().toUpperCase() === "VIDEO"),
          },
        });
      }, { isolationLevel: "RepeatableRead" }));
    },
  };
}