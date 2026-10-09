import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildFocusPlanProjection,
  buildFocusSessionProjection,
} from "../study-core/projection.js";
import { PROJECTION_CONTRACT_VERSION } from "../study-core/constants.js";
import { isStudyFeatureEnabled } from "../study-core/featureFlags.js";
import {
  canTransitionFocusSession,
  FOCUS_SESSION_STATES,
  type FocusSessionState,
} from "../study-core/focus.js";
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
  focusMetricsQuerySchema,
  focusHistoryQuerySchema,
  FOCUS_HISTORY_DEFAULT_LIMIT,
  FOCUS_HISTORY_MAX_LIMIT,
  type FocusMetricsPeriod,
  type FocusHistoryQuery,
} from "./schemas.js";
import { FocusRepository, type FocusTransaction } from "./repository.js";
import { decodeFocusHistoryCursor, encodeFocusHistoryCursor } from "./historyCursor.js";
import type { StudyEventRecord } from "../study-events/types.js";
import { ingestStudyEvent } from "../study-events/service.js";
import { enqueuePrivateD1Projection } from "../../services/privateD1Sync.js";
import { StudyPointsAwardEngine } from "../study-points/awardEngine.js";
import type { StudyPointsAwarder } from "../study-points/awardTypes.js";
import {
  fetchFocusPlanProjections,
  fetchStudyDailyMetricProjections,
  logPrivateReadFallback,
  privateReadEnabled,
  type FocusPlanReadProjection,
  fetchFocusSessionProjections,
} from "../../services/privateD1Read.js";
import type {
  FocusSessionProjection,
  StudyDailyMetricProjection,
} from "../study-core/projection.js";
import type {
  FocusBackendService,
  FocusBreakDto,
  FocusBreakMutationResult,
  FocusBreakSnapshot,
  FocusCurrentSessionResult,
  FocusPlanDto,
  FocusPlanItemDto,
  FocusSessionDto,
  FocusSessionMutationResult,
  FocusInterruptionResult,
  FocusMetricsDto,
  FocusMetricCounters,
  FocusMetricsDaily,
  FocusHistoryPageDto,
  FocusHistoryRowDto,
  FocusSessionSummaryDto,
  PostFocusActionContext,
} from "./types.js";

const NONTERMINAL_STATES = [
  "CREATED",
  "ACTIVE",
  "PAUSED",
  "RESOURCE_HANDOFF",
  "RECONCILIATION_REQUIRED",
] as const;

type FocusHistoryEventRecord = {
  focusSessionId: string | null;
  eventType: string;
  source: string;
  occurredAt: Date;
  payload: unknown;
};

type FocusLedgerRecord = {
  sourceId: string | null;
  amount: number;
  reasonCode: string;
  reversedBy: { amount: number } | null;
};

type FocusResourceLaunch = {
  resourceId: string;
  resourceType: "PDF" | "VIDEO";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resourceLaunch(payload: unknown): FocusResourceLaunch | null {
  if (!isRecord(payload)) return null;
  const resourceId = payload.resourceId;
  const resourceType = payload.resourceType;
  if (
    typeof resourceId !== "string" ||
    !resourceId ||
    (resourceType !== "PDF" && resourceType !== "VIDEO")
  ) return null;
  return { resourceId, resourceType };
}

function hasVerifiedCompletionEvent(
  session: { status: string; activeSeconds: number; actualEndedAt: Date | null },
  events: FocusHistoryEventRecord[],
): boolean {
  if (
    session.status !== "COMPLETED" ||
    !session.actualEndedAt ||
    !Number.isSafeInteger(session.activeSeconds) ||
    session.activeSeconds < 0
  ) return false;
  return events.some((event) => {
    if (
      event.eventType !== "focus_session_completed" ||
      event.source !== "backend" ||
      event.occurredAt.getTime() !== session.actualEndedAt?.getTime() ||
      !isRecord(event.payload)
    ) return false;
    return event.payload.activeSeconds === session.activeSeconds;
  });
}

function focusPointsBySession(
  entries: FocusLedgerRecord[],
): Map<string, { amount: number; reasonCode: string }> {
  const totals = new Map<string, { amount: number; reasonCode: string }>();
  for (const entry of entries) {
    if (!entry.sourceId) continue;
    const current = totals.get(entry.sourceId) ?? { amount: 0, reasonCode: entry.reasonCode };
    current.amount += entry.amount + (entry.reversedBy?.amount ?? 0);
    if (entry.amount > 0) current.reasonCode = entry.reasonCode;
    totals.set(entry.sourceId, current);
  }
  for (const [sessionId, value] of totals) {
    if (value.amount <= 0) totals.delete(sessionId);
  }
  return totals;
}

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

type SessionDtoInput = Pick<
  SessionRecord,
  | "id"
  | "planId"
  | "planItemId"
  | "lectureId"
  | "status"
  | "startedAt"
  | "plannedEndAt"
  | "actualEndedAt"
  | "lastCheckpointAt"
  | "activeSeconds"
  | "pauseSeconds"
  | "completionReason"
> & {
  planItem: Pick<PlanItemRecord, "sessionCount">;
};

type FocusBreakRecord = {
  id: string;
  userId: string;
  focusSessionId: string;
  durationSeconds: number;
  startedAt: Date;
  endsAt: Date;
  endedAt: Date | null;
  resumeStudyOnReturn: boolean;
  startIdempotencyKey: string;
  endIdempotencyKey: string | null;
  pausedAt: Date | null;
  pausedRemainingSeconds: number | null;
};

type FocusEventOperation =
  | "started" | "paused" | "resumed" | "completed" | "abandoned"
  | "handoff_started" | "handoff_returned" | "interruption";

type FocusServiceOptions = {
  repository?: FocusRepository;
  prisma?: PrismaClient;
  studyPointsAwarder?: StudyPointsAwarder;
  isFocusEnabled?: () => boolean;
  isStudyEventsEnabled?: () => boolean;
  isStudyPointsEnabled?: () => boolean;
  isResourceHandoffEnabled?: () => boolean;
  now?: () => Date;
  d1PlanReadsEnabled?: () => boolean;
  fetchPlansFromD1?: (
    userId: string,
    options: { limit?: number; status?: "ACTIVE" | "ARCHIVED" },
  ) => Promise<FocusPlanReadProjection[]>;
  d1SessionReadsEnabled?: () => boolean;
  fetchSessionsFromD1?: (
    userId: string,
    options?: { status?: string; limit?: number },
  ) => Promise<FocusSessionProjection[]>;
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

function timerInput(session: SessionDtoInput): FocusTimerSession {
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
  session: SessionDtoInput,
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

function focusBreakDto(row: FocusBreakRecord, now: Date): FocusBreakDto {
  const isPaused = row.endedAt === null && row.pausedAt !== null;
  return {
    id: row.id,
    focusSessionId: row.focusSessionId,
    durationSeconds: row.durationSeconds,
    startedAt: row.startedAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    endedAt: iso(row.endedAt),
    resumeStudyOnReturn: row.resumeStudyOnReturn,
    isPaused,
    remainingSeconds: isPaused
      ? Math.max(0, row.pausedRemainingSeconds ?? 0)
      : Math.max(0, Math.ceil((row.endsAt.getTime() - now.getTime()) / 1_000)),
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
type MetricRow = {
  metricDate: Date | string;
  focusSeconds: number;
  sessionsCompleted: number;
  interruptionCount: number;
};

type MetricProjectionState = {
  id: string;
  metricDate: Date | string;
  projectionRevision: bigint | number | string;
  updatedAt: Date | string;
};

type FocusSessionProjectionState = Pick<
  SessionRecord,
  "id" | "planId" | "planItemId" | "lectureId" | "status" | "updatedAt"
> & {
  projectionRevision: bigint | number | string;
  planItem: Pick<PlanItemRecord, "sessionCount">;
};

function canonicalIsoTimestamp(value: Date | string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function samePlanProjectionSnapshot(
  projected: readonly FocusPlanReadProjection[],
  canonical: readonly Pick<PlanRecord, "id" | "planVersion">[],
): boolean {
  return projected.length === canonical.length &&
    projected.every((plan, index) =>
      plan.id === canonical[index]?.id &&
      plan.planVersion === canonical[index]?.planVersion
    );
}

function sameMetricProjectionSnapshot(
  projected: readonly StudyDailyMetricProjection[],
  canonical: readonly MetricProjectionState[],
): boolean {
  if (projected.length !== canonical.length) return false;
  const canonicalById = new Map(canonical.map((row) => [row.id, row]));
  if (canonicalById.size !== canonical.length) return false;
  const seen = new Set<string>();
  for (const projection of projected) {
    if (seen.has(projection.id)) return false;
    seen.add(projection.id);
    const row = canonicalById.get(projection.id);
    if (!row || metricDateString(row.metricDate) !== projection.metricDate) return false;
    const revision = String(row.projectionRevision);
    if (!/^\d+$/u.test(revision)) return false;
    if (revision !== "0") {
      if (String(projection.revision) !== revision) return false;
      continue;
    }
    // Zero is reserved for legacy rows with no retained outbox entry.
    const canonicalUpdatedAt = row.updatedAt instanceof Date
      ? row.updatedAt.toISOString()
      : new Date(row.updatedAt).toISOString();
    if (projection.updatedAt !== canonicalUpdatedAt) return false;
  }
  return true;
}

function isValidFocusSessionProjection(
  projection: FocusSessionProjection,
  userId: string,
): boolean {
  const nullableTimestamps = [
    projection.startedAt,
    projection.plannedEndAt,
    projection.actualEndedAt,
    projection.lastCheckpointAt,
  ];
  return projection.id === projection.canonicalId &&
    projection.userId === userId &&
    projection.userScope === userId &&
    projection.deletedAt === null &&
    Number.isSafeInteger(projection.projectionVersion) &&
    projection.projectionVersion === PROJECTION_CONTRACT_VERSION &&
    /^\d+$/u.test(String(projection.revision)) &&
    typeof projection.planId === "string" &&
    typeof projection.planItemId === "string" &&
    typeof projection.lectureId === "string" &&
    FOCUS_SESSION_STATES.includes(projection.status as FocusSessionState) &&
    nullableTimestamps.every((value) =>
      value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)))
    ) &&
    Number.isSafeInteger(projection.activeSeconds) &&
    projection.activeSeconds >= 0 &&
    Number.isSafeInteger(projection.pauseSeconds) &&
    projection.pauseSeconds >= 0 &&
    (projection.completionReason === null || typeof projection.completionReason === "string") &&
    Number.isFinite(Date.parse(projection.updatedAt));
}

function sameFocusSessionProjectionSnapshot(
  projected: readonly FocusSessionProjection[],
  canonical: readonly FocusSessionProjectionState[],
): boolean {
  if (projected.length !== canonical.length) return false;
  const canonicalById = new Map(canonical.map((row) => [row.id, row]));
  if (canonicalById.size !== canonical.length) return false;
  const seen = new Set<string>();
  for (const projection of projected) {
    if (seen.has(projection.id)) return false;
    seen.add(projection.id);
    const row = canonicalById.get(projection.id);
    if (
      !row ||
      projection.status !== row.status ||
      projection.planId !== row.planId ||
      projection.planItemId !== row.planItemId ||
      projection.lectureId !== row.lectureId ||
      projection.updatedAt !== canonicalIsoTimestamp(row.updatedAt) ||
      !row.planItem ||
      !Number.isSafeInteger(row.planItem.sessionCount) ||
      row.planItem.sessionCount < 1
    ) return false;
    const revision = String(row.projectionRevision);
    if (!/^\d+$/u.test(revision)) return false;
    if (revision !== "0" && String(projection.revision) !== revision) return false;
  }
  return true;
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

async function getBreakSnapshot(
  tx: FocusTransaction,
  session: SessionRecord,
  now: Date,
): Promise<FocusBreakSnapshot> {
  const sessionDtoValue = await getSessionDto(tx, session, now);
  const activeBreak = await tx.focusBreak.findFirst({
    where: {
      userId: session.userId,
      focusSessionId: session.id,
      endedAt: null,
    },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
  }) as FocusBreakRecord | null;
  return {
    session: sessionDtoValue,
    breakSession: activeBreak ? focusBreakDto(activeBreak, now) : null,
    serverNow: now.toISOString(),
  };
}

async function transitionFocusBreak(
  tx: FocusTransaction,
  userId: string,
  session: SessionRecord,
  input: FocusSessionTransitionInput,
  clock: Date,
  action: "PAUSE" | "RESUME",
): Promise<FocusBreakMutationResult> {
  const priorCommand = await tx.focusBreakCommand.findUnique({
    where: {
      userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey },
    },
  });
  if (priorCommand) {
    if (priorCommand.action !== action) {
      throw new FocusError("IDEMPOTENCY_CONFLICT", "Break command key was used for another action.");
    }
    const priorBreak = await tx.focusBreak.findUnique({
      where: { id: priorCommand.focusBreakId },
    }) as FocusBreakRecord | null;
    if (!priorBreak || priorBreak.focusSessionId !== session.id) {
      throw new FocusError("IDEMPOTENCY_CONFLICT", "Break command key was used for another session.");
    }
    return {
      session: await getSessionDto(tx, session, clock),
      breakSession: focusBreakDto(priorBreak, clock),
      serverNow: clock.toISOString(),
      idempotency: "REPLAY_SAME_PAYLOAD",
    };
  }

  const activeBreak = await tx.focusBreak.findFirst({
    where: { userId, endedAt: null },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
  }) as FocusBreakRecord | null;
  if (!activeBreak || activeBreak.focusSessionId !== session.id) {
    throw new FocusError("INVALID_SESSION_STATE", "There is no current Focus Break to change.");
  }

  let breakRecord = activeBreak;
  let idempotency: FocusBreakMutationResult["idempotency"] = "ALREADY_ACTIVE";
  if (action === "PAUSE" && activeBreak.pausedAt === null) {
    const remainingSeconds = Math.max(
      0,
      Math.ceil((activeBreak.endsAt.getTime() - clock.getTime()) / 1_000),
    );
    if (remainingSeconds === 0) {
      throw new FocusError("INVALID_SESSION_STATE", "The Focus Break has ended and must return to Study.");
    }
    breakRecord = await tx.focusBreak.update({
      where: { id: activeBreak.id },
      data: { pausedAt: clock, pausedRemainingSeconds: remainingSeconds },
    }) as FocusBreakRecord;
    idempotency = "FIRST_SEEN";
  } else if (action === "RESUME" && activeBreak.pausedAt !== null) {
    const remainingSeconds = Math.max(0, activeBreak.pausedRemainingSeconds ?? 0);
    breakRecord = await tx.focusBreak.update({
      where: { id: activeBreak.id },
      data: {
        endsAt: new Date(clock.getTime() + remainingSeconds * 1_000),
        pausedAt: null,
        pausedRemainingSeconds: null,
      },
    }) as FocusBreakRecord;
    idempotency = "FIRST_SEEN";
  }

  await tx.focusBreakCommand.create({
    data: {
      userId,
      focusBreakId: activeBreak.id,
      idempotencyKey: input.idempotencyKey,
      action,
    },
  });
  return {
    session: await getSessionDto(tx, session, clock),
    breakSession: focusBreakDto(breakRecord, clock),
    serverNow: clock.toISOString(),
    idempotency,
  };
}

async function nextUncompletedPlanItemId(
  tx: FocusTransaction,
  userId: string,
  planId: string,
): Promise<string | null> {
  const [items, completed] = await Promise.all([
    tx.focusPlanItem.findMany({
      where: { planId },
      select: { id: true, sessionCount: true },
      orderBy: [{ sequence: "asc" }, { id: "asc" }],
    }),
    tx.focusSession.groupBy({
      by: ["planItemId"],
      where: { userId, planId, status: "COMPLETED" },
      _count: { _all: true },
    }),
  ]);
  const completedByItem = new Map(
    completed.map((entry) => [entry.planItemId, entry._count._all]),
  );
  return items.find((item) =>
    (completedByItem.get(item.id) ?? 0) < item.sessionCount)?.id ?? null;
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
  const isStudyPointsEnabled = options.isStudyPointsEnabled ??
    (() => isStudyFeatureEnabled("STUDY_POINTS_ENABLED"));
  const isResourceHandoffEnabled = options.isResourceHandoffEnabled ??
    (() => isStudyFeatureEnabled("FOCUS_RESOURCE_HANDOFF_ENABLED"));
  const now = options.now ?? (() => new Date());
  const studyPointsAwarder = options.studyPointsAwarder
    ?? new StudyPointsAwardEngine(repository.database, now);
  const d1PlanReadsEnabled = options.d1PlanReadsEnabled ??
    (() => privateReadEnabled("PRIVATE_D1_FOCUS_PLAN_READS_ENABLED"));
  const fetchPlansFromD1 = options.fetchPlansFromD1 ?? fetchFocusPlanProjections;
  const d1SessionReadsEnabled = options.d1SessionReadsEnabled ??
    (() => privateReadEnabled("PRIVATE_D1_FOCUS_SESSION_READS_ENABLED"));
  const fetchSessionsFromD1 = options.fetchSessionsFromD1 ?? fetchFocusSessionProjections;
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

  function requireResourceHandoff(): void {
    if (!isResourceHandoffEnabled()) {
      throw new FocusError("FEATURE_DISABLED", "Focus Resource Handoff is disabled.");
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

    async listPlans(userId, limit = 100, options = {}) {
      requireFocus();
      const boundedLimit = Number.isInteger(limit) ? Math.min(100, Math.max(1, limit)) : 100;
      if (!options.canonical && d1PlanReadsEnabled()) {
        try {
          const projections = await fetchPlansFromD1(userId, {
            limit: boundedLimit,
            status: options.status,
          });
          const canonical = await repository.database.focusPlan.findMany({
            where: { userId, ...(options.status ? { status: options.status } : {}) },
            select: { id: true, planVersion: true },
            orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
            take: boundedLimit,
          }) as Array<Pick<PlanRecord, "id" | "planVersion">>;
          if (!samePlanProjectionSnapshot(projections, canonical)) {
            throw new Error("Private Focus Plan projection is behind canonical state.");
          }
          return projections.map(d1PlanDto);
        } catch (error) {
          logPrivateReadFallback("Focus Plan projection read", error);
        }
      }
      return safely(async () => {
        const rows = await repository.database.focusPlan.findMany({
          where: { userId, ...(options.status ? { status: options.status } : {}) },
          include: { items: { orderBy: [{ sequence: "asc" }, { id: "asc" }] } },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          take: boundedLimit,
        }) as PlanRecord[];
        return rows.map(planDto);
      });
    },

    async getPlan(userId, planId, options = {}) {
      requireFocus();
      if (!options.canonical && d1PlanReadsEnabled()) {
        try {
          const projections = await fetchPlansFromD1(userId, { limit: 100 });
          const projection = projections.find((plan) => plan.id === planId);
          if (projection) {
            const canonical = await repository.database.focusPlan.findFirst({
              where: { id: planId, userId },
              select: { id: true, planVersion: true },
            }) as Pick<PlanRecord, "id" | "planVersion"> | null;
            if (!canonical || projection.planVersion !== canonical.planVersion) {
              throw new Error("Private Focus Plan projection is behind canonical state.");
            }
            return d1PlanDto(projection);
          }
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

        const activeBreak = await tx.focusBreak.findFirst({
          where: { userId, endedAt: null },
          select: { id: true },
        });
        if (activeBreak) {
          throw new FocusError("INVALID_SESSION_STATE", "End the current Focus Break before starting another session.");
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
        const activeBreak = await tx.focusBreak.findFirst({
          where: { userId, endedAt: null },
          select: { id: true },
        });
        if (activeBreak) {
          throw new FocusError("INVALID_SESSION_STATE", "Return from the current Focus Break before resuming Study.");
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
      requireResourceHandoff();
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
        requireResourceHandoff();
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
          requireResourceHandoff();
          throw new FocusError("INVALID_SESSION_STATE", "This Focus Session is not in resource handoff.");
        }
        // Let an already-running handoff return safely after the flag is
        // disabled, but do not permit any new handoff transitions.
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
        let d1Snapshot: {
          projected: FocusSessionProjection[];
          canonical: FocusSessionProjectionState[];
        } | null = null;
        if (d1SessionReadsEnabled()) {
          try {
            // The Worker sorts by updatedAt DESC. Two rows are enough to detect
            // duplicate current sessions; if the current row falls outside that
            // window, the canonical snapshot comparison below forces fallback.
            const projections = await fetchSessionsFromD1(userId, { limit: 2 });
            if (
              !Array.isArray(projections) ||
              projections.length > 2 ||
              projections.some((projection) => !isValidFocusSessionProjection(projection, userId))
            ) {
              throw new Error("Private Focus Session projection is malformed or out of scope.");
            }
            const currentProjections = projections.filter((projection) =>
              NONTERMINAL_STATES.some((status) => status === projection.status)
            );
            const canonical = await repository.database.focusSession.findMany({
              where: { userId, status: { in: [...NONTERMINAL_STATES] } },
              select: {
                id: true,
                planId: true,
                planItemId: true,
                lectureId: true,
                status: true,
                projectionRevision: true,
                updatedAt: true,
                planItem: { select: { sessionCount: true } },
              },
              orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
              take: 2,
            }) as FocusSessionProjectionState[];
            if (!sameFocusSessionProjectionSnapshot(currentProjections, canonical)) {
              throw new Error("Private Focus Session projection is behind canonical state.");
            }
            d1Snapshot = { projected: currentProjections, canonical };
          } catch (error) {
            logPrivateReadFallback("Focus Session projection read", error);
          }
        }
        if (d1Snapshot) {
          if (d1Snapshot.canonical.length > 1) {
            throw new FocusError(
              "RECONCILIATION_REQUIRED",
              "More than one nonterminal solo session exists for this user.",
            );
          }
          if (!d1Snapshot.canonical.length) {
            return { session: null, serverNow: clock.toISOString() };
          }
          const projection = d1Snapshot.projected[0];
          const canonical = d1Snapshot.canonical[0];
          if (!projection || !canonical) {
            throw new FocusError("RECONCILIATION_REQUIRED", "Focus Session snapshot is incomplete.");
          }
          const session: SessionDtoInput = {
            id: projection.id,
            planId: projection.planId,
            planItemId: projection.planItemId,
            lectureId: projection.lectureId,
            status: projection.status as FocusSessionState,
            startedAt: projection.startedAt === null ? null : new Date(projection.startedAt),
            plannedEndAt: projection.plannedEndAt === null ? null : new Date(projection.plannedEndAt),
            actualEndedAt: projection.actualEndedAt === null ? null : new Date(projection.actualEndedAt),
            lastCheckpointAt: projection.lastCheckpointAt === null
              ? null
              : new Date(projection.lastCheckpointAt),
            activeSeconds: projection.activeSeconds,
            pauseSeconds: projection.pauseSeconds,
            completionReason: projection.completionReason,
            planItem: canonical.planItem,
          };
          const count = await repository.database.focusSession.count({
            where: { userId, planItemId: session.planItemId, status: "COMPLETED" },
          });
          return {
            session: sessionDto(session, clock, count),
            serverNow: clock.toISOString(),
          };
        }

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

    async getBreak(userId, sessionId): Promise<FocusBreakSnapshot> {
      requireSessionDependencies();
      return safely(async () => repository.transaction(async (tx) => {
        await repository.lockUser(tx, userId);
        const clock = assertValidClock(now());
        const session = await ownedSession(tx, userId, sessionId);
        return getBreakSnapshot(tx, session, clock);
      }));
    },

    async startBreak(userId, sessionId, rawInput): Promise<FocusBreakMutationResult> {
      requireSessionDependencies();
      const input = validateTransition(rawInput);
      return safely(async () => repository.transaction(async (tx) => {
        await repository.lockUser(tx, userId);
        let session = await ownedSession(tx, userId, sessionId);
        const clock = assertValidClock(now());
        const priorByKey = await tx.focusBreak.findUnique({
          where: {
            userId_startIdempotencyKey: {
              userId,
              startIdempotencyKey: input.idempotencyKey,
            },
          },
        }) as FocusBreakRecord | null;
        if (priorByKey) {
          if (
            priorByKey.focusSessionId !== session.id ||
            priorByKey.durationSeconds !== session.planItem.breakDurationSeconds
          ) {
            throw new FocusError("IDEMPOTENCY_CONFLICT", "Break key was already used for another break.");
          }
          return {
            session: await getSessionDto(tx, session, clock),
            breakSession: focusBreakDto(priorByKey, clock),
            serverNow: clock.toISOString(),
            idempotency: "REPLAY_SAME_PAYLOAD",
          };
        }

        const activeBreak = await tx.focusBreak.findFirst({
          where: { userId, endedAt: null },
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        }) as FocusBreakRecord | null;
        if (activeBreak) {
          if (activeBreak.focusSessionId !== session.id) {
            throw new FocusError("INVALID_SESSION_STATE", "Another Focus Break is already active.");
          }
          return {
            session: await getSessionDto(tx, session, clock),
            breakSession: focusBreakDto(activeBreak, clock),
            serverNow: clock.toISOString(),
            idempotency: "ALREADY_ACTIVE",
          };
        }

        const otherSession = await tx.focusSession.findFirst({
          where: {
            userId,
            id: { not: session.id },
            status: { in: [...NONTERMINAL_STATES] },
          },
          select: { id: true },
        });
        if (otherSession) {
          throw new FocusError("INVALID_SESSION_STATE", "This is no longer the current Focus Session.");
        }
        if (!["ACTIVE", "PAUSED", "COMPLETED"].includes(session.status)) {
          throw new FocusError("INVALID_SESSION_STATE", "A Focus Break cannot start in this session state.");
        }

        const resumeStudyOnReturn = session.status === "ACTIVE";
        if (session.status === "ACTIVE") {
          const action = pauseFocusTimer(timerInput(session), clock);
          if (action.status === "RECONCILIATION_REQUIRED") {
            throw new FocusError("RECONCILIATION_REQUIRED", "Session timer needs reconciliation before a break can start.");
          }
          if (action.status === "SESSION_READY_TO_COMPLETE") {
            const dto = await getSessionDto(tx, session, clock);
            throw new FocusError(
              "SESSION_READY_TO_COMPLETE",
              "The planned focus duration has elapsed; complete the session before starting a break.",
              undefined,
              { session: dto },
            );
          }
          session = await tx.focusSession.update({
            where: { id: session.id },
            data: {
              status: "PAUSED",
              activeSeconds: action.activeSeconds as number,
              lastCheckpointAt: clock,
            },
            include: { planItem: true },
          }) as SessionRecord;
          await ingestFocusEvent(tx, {
            eventType: "focus_session_paused",
            userId,
            occurredAt: clock,
            source: input.source,
            idempotencyKey: focusEventKey("paused", session.id, `break-start:${input.idempotencyKey}`),
            lectureId: session.lectureId,
            focusSessionId: session.id,
            evidenceClass: "CLIENT_OBSERVED",
            payload: {},
          });
          await enqueueSessionProjection(tx, session);
        }

        const durationSeconds = session.planItem.breakDurationSeconds;
        const created = await tx.focusBreak.create({
          data: {
            userId,
            focusSessionId: session.id,
            durationSeconds,
            startedAt: clock,
            endsAt: new Date(clock.getTime() + durationSeconds * 1_000),
            resumeStudyOnReturn,
            startIdempotencyKey: input.idempotencyKey,
          },
        }) as FocusBreakRecord;
        return {
          session: await getSessionDto(tx, session, clock),
          breakSession: focusBreakDto(created, clock),
          serverNow: clock.toISOString(),
          idempotency: "FIRST_SEEN",
        };
      }));
    },

    async pauseBreak(userId, sessionId, rawInput): Promise<FocusBreakMutationResult> {
      requireSessionDependencies();
      const input = validateTransition(rawInput);
      return safely(async () => repository.transaction(async (tx) => {
        await repository.lockUser(tx, userId);
        const session = await ownedSession(tx, userId, sessionId);
        const clock = assertValidClock(now());
        return transitionFocusBreak(tx, userId, session, input, clock, "PAUSE");
      }));
    },

    async resumeBreak(userId, sessionId, rawInput): Promise<FocusBreakMutationResult> {
      requireSessionDependencies();
      const input = validateTransition(rawInput);
      return safely(async () => repository.transaction(async (tx) => {
        await repository.lockUser(tx, userId);
        const session = await ownedSession(tx, userId, sessionId);
        const clock = assertValidClock(now());
        return transitionFocusBreak(tx, userId, session, input, clock, "RESUME");
      }));
    },

    async returnFromBreak(userId, sessionId, rawInput): Promise<FocusBreakMutationResult> {
      requireSessionDependencies();
      const input = validateTransition(rawInput);
      return safely(async () => repository.transaction(async (tx) => {
        await repository.lockUser(tx, userId);
        let session = await ownedSession(tx, userId, sessionId);
        const clock = assertValidClock(now());
        const priorByKey = await tx.focusBreak.findFirst({
          where: { userId, endIdempotencyKey: input.idempotencyKey },
        }) as FocusBreakRecord | null;
        if (priorByKey) {
          if (priorByKey.focusSessionId !== session.id) {
            throw new FocusError("IDEMPOTENCY_CONFLICT", "Break return key was already used for another session.");
          }
          return {
            session: await getSessionDto(tx, session, clock),
            breakSession: focusBreakDto(priorByKey, clock),
            serverNow: clock.toISOString(),
            idempotency: "REPLAY_SAME_PAYLOAD",
          };
        }

        const activeBreak = await tx.focusBreak.findFirst({
          where: { userId, focusSessionId: session.id, endedAt: null },
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        }) as FocusBreakRecord | null;
        if (!activeBreak) {
          const anotherActiveBreak = await tx.focusBreak.findFirst({
            where: { userId, endedAt: null },
            select: { focusSessionId: true },
          });
          if (anotherActiveBreak) {
            throw new FocusError("INVALID_SESSION_STATE", "Another Focus Break is active for this account.");
          }
          const latestBreak = await tx.focusBreak.findFirst({
            where: { userId, focusSessionId: session.id },
            orderBy: [{ startedAt: "desc" }, { id: "desc" }],
          }) as FocusBreakRecord | null;
          if (!latestBreak) {
            throw new FocusError("INVALID_SESSION_STATE", "There is no Focus Break to return from.");
          }
          return {
            session: await getSessionDto(tx, session, clock),
            breakSession: focusBreakDto(latestBreak, clock),
            serverNow: clock.toISOString(),
            idempotency: "ALREADY_ENDED",
          };
        }

        const endedBreak = await tx.focusBreak.update({
          where: { id: activeBreak.id },
          data: {
            endedAt: clock,
            endIdempotencyKey: input.idempotencyKey,
            pausedAt: null,
            pausedRemainingSeconds: null,
          },
        }) as FocusBreakRecord;
        if (activeBreak.resumeStudyOnReturn && session.status === "PAUSED") {
          const action = resumeFocusTimer(timerInput(session), clock);
          if (action.status === "RECONCILIATION_REQUIRED") {
            throw new FocusError("RECONCILIATION_REQUIRED", "Session timer needs reconciliation before Study can resume.");
          }
          session = await tx.focusSession.update({
            where: { id: session.id },
            data: {
              status: "ACTIVE",
              pauseSeconds: action.pauseSeconds as number,
              plannedEndAt: new Date(action.plannedEndAt as string | Date),
              lastCheckpointAt: clock,
            },
            include: { planItem: true },
          }) as SessionRecord;
          await ingestFocusEvent(tx, {
            eventType: "focus_session_resumed",
            userId,
            occurredAt: clock,
            source: input.source,
            idempotencyKey: focusEventKey("resumed", session.id, `break-return:${input.idempotencyKey}`),
            lectureId: session.lectureId,
            focusSessionId: session.id,
            evidenceClass: "CLIENT_OBSERVED",
            payload: {},
          });
          await enqueueSessionProjection(tx, session);
        }
        return {
          session: await getSessionDto(tx, session, clock),
          breakSession: focusBreakDto(endedBreak, clock),
          serverNow: clock.toISOString(),
          idempotency: "FIRST_SEEN",
        };
      }));
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

        const activeBreak = await tx.focusBreak.findFirst({
          where: { userId, endedAt: null },
          select: { focusSessionId: true },
        });
        if (activeBreak) {
          throw new FocusError("INVALID_SESSION_STATE", "Return from the current Focus Break before completing Study.");
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
        if (isStudyPointsEnabled()) {
          await studyPointsAwarder.awardStudyPointsForSource({
            userId,
            sourceType: "FOCUS_SESSION",
            sourceId: updated.id,
            now: clock,
            tx,
          });
        }
        await enqueueSessionProjection(tx, updated);
        if (await nextUncompletedPlanItemId(tx, userId, updated.planId)) {
          const automaticBreakKey = `post-completion:${updated.id}`;
          const existingBreak = await tx.focusBreak.findUnique({
            where: {
              userId_startIdempotencyKey: {
                userId,
                startIdempotencyKey: automaticBreakKey,
              },
            },
          });
          if (!existingBreak) {
            const durationSeconds = updated.planItem.breakDurationSeconds;
            await tx.focusBreak.create({
              data: {
                userId,
                focusSessionId: updated.id,
                durationSeconds,
                startedAt: clock,
                endsAt: new Date(clock.getTime() + durationSeconds * 1_000),
                resumeStudyOnReturn: false,
                startIdempotencyKey: automaticBreakKey,
              },
            });
          }
        }
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
        await tx.focusBreak.updateMany({
          where: { userId, focusSessionId: session.id, endedAt: null },
          data: {
            endedAt: clock,
            endIdempotencyKey: focusEventKey("abandoned", session.id, input.idempotencyKey),
          },
        });
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
            const canonical = await repository.database.studyDailyMetric.findMany({
              where: {
                userId,
                metricDate: {
                  gte: new Date(`${range.startDate}T00:00:00.000Z`),
                  lte: new Date(`${range.endDate}T00:00:00.000Z`),
                },
              },
              select: {
                id: true,
                metricDate: true,
                projectionRevision: true,
                updatedAt: true,
              },
              orderBy: { metricDate: "asc" },
            }) as MetricProjectionState[];
            if (!sameMetricProjectionSnapshot(projected, canonical)) {
              throw new Error("Private Study Daily Metric projection is behind canonical state.");
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

    async getSessionSummary(userId, sessionId): Promise<FocusSessionSummaryDto> {
      requireFocus();
      return safely(async () => repository.database.$transaction(async (tx) => {
        const session = await tx.focusSession.findFirst({
          where: { id: sessionId, userId },
          include: {
            planItem: true,
            plan: {
              include: {
                items: {
                  orderBy: [{ sequence: "asc" }, { id: "asc" }],
                  include: { lecture: true },
                },
              },
            },
            lecture: true,
          },
        }) as (SessionRecord & {
          planItem: PlanItemRecord;
          plan: {
            id: string;
            title: string;
            status: string;
            items: Array<PlanItemRecord & {
              lecture: { id: string; name: string; mainSubject: string };
            }>;
          };
          lecture: { id: string; name: string; mainSubject: string };
        }) | null;
        if (!session) throw new FocusError("SESSION_NOT_FOUND", "Focus Session was not found.");
        if (!["COMPLETED", "ABANDONED", "EXPIRED"].includes(session.status)) {
          throw new FocusError(
            "INVALID_SESSION_STATE",
            "A completion summary is available only after a Focus Session ends.",
          );
        }

        const [events, groups, completedBefore] = await Promise.all([
          tx.studyEvent.findMany({
            where: {
              userId,
              focusSessionId: session.id,
              eventType: { in: ["focus_session_completed", "focus_resource_handoff_started"] },
            },
            select: {
              focusSessionId: true,
              eventType: true,
              source: true,
              occurredAt: true,
              payload: true,
            },
          }) as Promise<FocusHistoryEventRecord[]>,
          tx.focusSession.groupBy({
            by: ["planItemId", "status"],
            where: { userId, planId: session.planId },
            _count: { _all: true },
          }),
          session.startedAt
            ? tx.focusSession.count({
                where: {
                  userId,
                  planItemId: session.planItemId,
                  status: "COMPLETED",
                  OR: [
                    { startedAt: { lt: session.startedAt } },
                    { startedAt: session.startedAt, id: { lt: session.id } },
                  ],
                },
              })
            : Promise.resolve(0),
        ]);

        const verified = hasVerifiedCompletionEvent(session, events);
        const launches = events
          .filter((event) => event.eventType === "focus_resource_handoff_started")
          .flatMap((event) => {
            const launch = resourceLaunch(event.payload);
            return launch ? [launch] : [];
          });
        const launchMap = new Map<string, { resourceType: "PDF" | "VIDEO"; launchCount: number }>();
        for (const launch of launches) {
          const current = launchMap.get(launch.resourceId);
          if (current) current.launchCount += 1;
          else launchMap.set(launch.resourceId, { resourceType: launch.resourceType, launchCount: 1 });
        }
        const materials = launchMap.size
          ? await tx.material.findMany({
              where: { id: { in: [...launchMap.keys()] } },
              select: { id: true, title: true, type: true },
            })
          : [];
        const materialById = new Map(materials.map((material) => [material.id, material]));
        const resourceItems = [...launchMap.entries()].map(([resourceId, launch]) => {
          const material = materialById.get(resourceId);
          const normalizedType = material?.type.trim().toUpperCase();
          return {
            resourceId,
            resourceType: launch.resourceType,
            title: normalizedType === launch.resourceType ? material?.title ?? null : null,
            launchCount: launch.launchCount,
          };
        });

        const pointRows = verified
          ? await tx.studyPointsLedgerEntry.findMany({
              where: {
                userId,
                sourceType: "FOCUS_SESSION",
                sourceId: session.id,
                category: "FOCUS",
              },
              select: {
                sourceId: true,
                amount: true,
                reasonCode: true,
                reversedBy: { select: { amount: true } },
              },
            }) as FocusLedgerRecord[]
          : [];
        const points = focusPointsBySession(pointRows).get(session.id) ?? null;
        const completedByItem = new Map<string, number>();
        let completedSessions = 0;
        for (const group of groups) {
          if (group.status !== "COMPLETED") continue;
          const count = group._count._all;
          completedByItem.set(group.planItemId, count);
          completedSessions += count;
        }
        const totalPlannedSessions = session.plan.items.reduce(
          (total, item) => total + item.sessionCount,
          0,
        );
        const nextItem = session.plan.items.find(
          (item) => (completedByItem.get(item.id) ?? 0) < item.sessionCount,
        );
        const nextAction = !nextItem
          ? { kind: "PLAN_FINISHED" as const, planItemId: null, lectureId: null, lectureTitle: null }
          : session.plan.status !== "ACTIVE"
            ? { kind: "UNAVAILABLE" as const, planItemId: null, lectureId: null, lectureTitle: null }
            : {
                kind: nextItem.lectureId === session.lectureId ? "NEXT_SESSION" as const : "NEXT_LECTURE" as const,
                planItemId: nextItem.id,
                lectureId: nextItem.lectureId,
                lectureTitle: nextItem.lecture.name,
              };
        const sessionNumber = Math.min(completedBefore + 1, session.planItem.sessionCount);
        const isLastPlannedSession =
          session.status === "COMPLETED" &&
          sessionNumber >= session.planItem.sessionCount;

        return {
          sessionId: session.id,
          status: session.status,
          plan: {
            id: session.plan.id,
            title: session.plan.title,
            status: session.plan.status,
          },
          lecture: {
            id: session.lecture.id,
            title: session.lecture.name,
            subject: session.lecture.mainSubject,
          },
          progress: {
            sessionNumber,
            plannedSessionCount: session.planItem.sessionCount,
            isLastPlannedSession,
            completedSessions,
            totalPlannedSessions,
          },
          timing: {
            plannedFocusSeconds: session.planItem.focusDurationSeconds,
            verifiedFocusSeconds: verified ? session.activeSeconds : null,
            plannedBreakSeconds: session.planItem.breakDurationSeconds,
            startedAt: iso(session.startedAt),
            terminalAt: iso(session.actualEndedAt),
          },
          points,
          resources: {
            launchCount: launches.length,
            uniqueResourceCount: launchMap.size,
            items: resourceItems,
          },
          nextAction,
        };
      }, { isolationLevel: "RepeatableRead" }));
    },

    async listHistory(userId, rawQuery: FocusHistoryQuery): Promise<FocusHistoryPageDto> {
      requireFocus();
      const parsed = focusHistoryQuerySchema.safeParse(rawQuery);
      if (!parsed.success) throw requestInputError("Focus history query is invalid.");
      const query = parsed.data;
      const limit = Math.min(
        Math.max(query.limit ?? FOCUS_HISTORY_DEFAULT_LIMIT, 1),
        FOCUS_HISTORY_MAX_LIMIT,
      );
      const cursor = query.cursor ? decodeFocusHistoryCursor(query.cursor) : null;
      return safely(async () => repository.database.$transaction(async (tx) => {
        const where: Prisma.FocusSessionWhereInput = {
          userId,
          startedAt: { not: null },
          ...(query.status ? { status: query.status } : {}),
          ...(query.lectureId ? { lectureId: query.lectureId } : {}),
          ...(query.subject ? { lecture: { is: { mainSubject: query.subject } } } : {}),
          ...(cursor
            ? {
                OR: [
                  { startedAt: { lt: cursor.startedAt } },
                  { startedAt: cursor.startedAt, id: { lt: cursor.sessionId } },
                ],
              }
            : {}),
        };
        const rows = await tx.focusSession.findMany({
          where,
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          select: {
            id: true,
            status: true,
            planId: true,
            planItemId: true,
            lectureId: true,
            startedAt: true,
            actualEndedAt: true,
            activeSeconds: true,
            plan: { select: { title: true, status: true } },
            planItem: { select: { focusDurationSeconds: true } },
            lecture: { select: { name: true, mainSubject: true } },
          },
        }) as Array<{
          id: string;
          status: string;
          planId: string;
          planItemId: string;
          lectureId: string;
          startedAt: Date | null;
          actualEndedAt: Date | null;
          activeSeconds: number;
          plan: { title: string; status: string };
          planItem: { focusDurationSeconds: number };
          lecture: { name: string; mainSubject: string };
        }>;
        const hasMore = rows.length > limit;
        const pageRows = rows.slice(0, limit);
        const sessionIds = pageRows.map((row) => row.id);
        const completionIds = pageRows
          .filter((row) => row.status === "COMPLETED")
          .map((row) => row.id);
        const [events, pointRows] = sessionIds.length
          ? await Promise.all([
              tx.studyEvent.findMany({
                where: { userId, focusSessionId: { in: sessionIds } },
                select: {
                  focusSessionId: true,
                  eventType: true,
                  source: true,
                  occurredAt: true,
                  payload: true,
                },
              }) as Promise<FocusHistoryEventRecord[]>,
              completionIds.length
                ? tx.studyPointsLedgerEntry.findMany({
                    where: {
                      userId,
                      sourceType: "FOCUS_SESSION",
                      sourceId: { in: completionIds },
                      category: "FOCUS",
                    },
                    select: {
                      sourceId: true,
                      amount: true,
                      reasonCode: true,
                      reversedBy: { select: { amount: true } },
                    },
                  }) as Promise<FocusLedgerRecord[]>
                : Promise.resolve([] as FocusLedgerRecord[]),
            ])
          : [[], []] as [FocusHistoryEventRecord[], FocusLedgerRecord[]];
        const eventRows = events as FocusHistoryEventRecord[];
        const launchesBySession = new Map<string, FocusResourceLaunch[]>();
        const completionEventsBySession = new Map<string, FocusHistoryEventRecord[]>();
        for (const event of eventRows) {
          if (!event.focusSessionId) continue;
          if (event.eventType === "focus_resource_handoff_started") {
            const launch = resourceLaunch(event.payload);
            if (launch) {
              const current = launchesBySession.get(event.focusSessionId) ?? [];
              current.push(launch);
              launchesBySession.set(event.focusSessionId, current);
            }
          }
          if (event.eventType === "focus_session_completed") {
            const current = completionEventsBySession.get(event.focusSessionId) ?? [];
            current.push(event);
            completionEventsBySession.set(event.focusSessionId, current);
          }
        }
        const pointsBySession = focusPointsBySession(pointRows as FocusLedgerRecord[]);
        const items: FocusHistoryRowDto[] = pageRows.map((row) => {
          const sessionEvents = completionEventsBySession.get(row.id) ?? [];
          const verified = hasVerifiedCompletionEvent(row, sessionEvents);
          const launches = launchesBySession.get(row.id) ?? [];
          const uniqueResources = new Set(launches.map((launch) => launch.resourceId));
          return {
            sessionId: row.id,
            status: row.status as FocusHistoryRowDto["status"],
            planId: row.planId,
            planTitle: row.plan.title,
            planStatus: row.plan.status,
            planItemId: row.planItemId,
            lectureId: row.lectureId,
            lectureTitle: row.lecture.name,
            subject: row.lecture.mainSubject,
            plannedFocusSeconds: row.planItem.focusDurationSeconds,
            verifiedFocusSeconds: verified ? row.activeSeconds : null,
            startedAt: iso(row.startedAt),
            terminalAt: iso(row.actualEndedAt),
            points: verified ? pointsBySession.get(row.id)?.amount ?? null : null,
            resourceLaunchCount: launches.length,
            uniqueResourceCount: uniqueResources.size,
          };
        });
        const last = pageRows.at(-1);
        return {
          items,
          limit,
          nextCursor: hasMore && last?.startedAt
            ? encodeFocusHistoryCursor({ startedAt: last.startedAt, sessionId: last.id })
            : null,
        };
      }, { isolationLevel: "RepeatableRead" }));
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