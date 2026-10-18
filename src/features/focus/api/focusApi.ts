import { apiClient } from "../../../core/api/apiClient";
import type {
  AbandonFocusSessionInput,
  CompleteFocusSessionInput,
  CreateFocusPlanInput,
  FocusSessionTransitionInput,
  StartFocusSessionInput,
  UpdateFocusPlanInput,
  FocusMetricsPeriod,
} from "../../../../server/features/focus/schemas";
import type {
  FocusCurrentSessionResult,
  FocusMetricsDto,
  FocusPlanDto,
  FocusPlanItemDto,
  PostFocusActionContext,
  FocusSessionDto,
  FocusSessionMutationResult,
  FocusBreakDto,
  FocusBreakMutationResult,
  FocusBreakSnapshot,
  FocusHistoryPageDto,
  FocusSessionSummaryDto,
} from "../../../../server/features/focus/types";
import type { FocusHistoryQuery } from "../../../../server/features/focus/schemas";
import {
  getFocusClientInstanceId,
  invalidateFocusResources,
  readFocusResource,
  resourcesForFocusMutation,
} from "./focusSync";

export type FocusResourceType = "PDF" | "VIDEO";
export type FocusClientSource = "web" | "pwa" | "ios" | "android";

export interface ResourceHandoffStartInput {
  resourceType: FocusResourceType;
  resourceId: string;
  idempotencyKey: string;
  source: FocusClientSource;
}

export interface ResourceHandoffReturnInput {
  idempotencyKey: string;
  source: FocusClientSource;
  targetState: "ACTIVE";
}

export interface RecordInterruptionInput {
  observedAwaySeconds: number;
  reason: string;
  idempotencyKey: string;
  source: FocusClientSource;
}

export interface FocusInterruptionResult {
  idempotency: "FIRST_SEEN" | "REPLAY_SAME_PAYLOAD";
}

export interface FocusApiRequestOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  bypassCache?: boolean;
  requestKey?: string;
}

type Requester = (
  input: RequestInfo | URL,
  options?: FocusApiRequestOptions,
) => Promise<Response>;

export type FocusApiErrorKind = "transport" | "http" | "protocol";

export class FocusApiError extends Error {
  constructor(
    readonly kind: FocusApiErrorKind,
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FocusApiError";
  }
}

export function isRetryableFocusReadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { kind?: string; status?: number };
  return candidate.kind === "transport" ||
    (candidate.kind === "http" && (candidate.status ?? 0) >= 500);
}

export interface FocusApi {
  getCurrentFocusSession(): Promise<FocusCurrentSessionResult>;
  startFocusSession(input: StartFocusSessionInput): Promise<FocusSessionMutationResult>;
  pauseFocusSession(sessionId: string, input: FocusSessionTransitionInput): Promise<FocusSessionMutationResult>;
  resumeFocusSession(sessionId: string, input: FocusSessionTransitionInput): Promise<FocusSessionMutationResult>;
  getFocusBreak(sessionId: string): Promise<FocusBreakSnapshot>;
  startFocusBreak(sessionId: string, input: FocusSessionTransitionInput): Promise<FocusBreakMutationResult>;
  pauseFocusBreak(sessionId: string, input: FocusSessionTransitionInput): Promise<FocusBreakMutationResult>;
  resumeFocusBreak(sessionId: string, input: FocusSessionTransitionInput): Promise<FocusBreakMutationResult>;
  returnFromFocusBreak(sessionId: string, input: FocusSessionTransitionInput): Promise<FocusBreakMutationResult>;
  completeFocusSession(sessionId: string, input: CompleteFocusSessionInput): Promise<FocusSessionMutationResult>;
  abandonFocusSession(sessionId: string, input: AbandonFocusSessionInput): Promise<FocusSessionMutationResult>;
  startResourceHandoff?(sessionId: string, input: ResourceHandoffStartInput): Promise<FocusSessionMutationResult>;
  returnFromResourceHandoff?(sessionId: string, input: ResourceHandoffReturnInput): Promise<FocusSessionMutationResult>;
  recordInterruption?(sessionId: string, input: RecordInterruptionInput): Promise<FocusInterruptionResult>;
  createFocusPlan(input: CreateFocusPlanInput): Promise<FocusPlanDto>;
  listFocusPlans(
    limit?: number,
    options?: { status?: "ACTIVE" | "ARCHIVED"; canonical?: boolean },
  ): Promise<FocusPlanDto[]>;
  getFocusPlan(planId: string, options?: { canonical?: boolean }): Promise<FocusPlanDto>;
  updateFocusPlan(planId: string, input: UpdateFocusPlanInput): Promise<FocusPlanDto>;
  archiveFocusPlan(planId: string): Promise<FocusPlanDto>;
  getMetrics(period: FocusMetricsPeriod): Promise<FocusMetricsDto>;
  getPostFocusActionContext(sessionId: string): Promise<PostFocusActionContext>;
  getSessionSummary(sessionId: string): Promise<FocusSessionSummaryDto>;
  listHistory(query?: Partial<FocusHistoryQuery>): Promise<FocusHistoryPageDto>;
}

const SESSION_STATES = new Set([
  "CREATED", "ACTIVE", "PAUSED", "RESOURCE_HANDOFF", "COMPLETED",
  "ABANDONED", "EXPIRED", "RECONCILIATION_REQUIRED",
]);
const IDEMPOTENCY_RESULTS = new Set(["CREATED", "FIRST_SEEN", "REPLAY_SAME_PAYLOAD"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function protocol(message: string): FocusApiError {
  return new FocusApiError("protocol", message, "PROTOCOL_ERROR");
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw protocol(`Invalid Focus ${name}.`);
  return value as Record<string, unknown>;
}

function stringField(value: unknown, name: string, options: { uuid?: boolean; nullable?: boolean } = {}): string | null {
  if (value === null && options.nullable) return null;
  if (typeof value !== "string" || !value || (options.uuid && !UUID.test(value)) ||
      (!options.uuid && !Number.isFinite(Date.parse(value)))) throw protocol(`Invalid Focus ${name}.`);
  return value;
}

function opaqueIdentifierField(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 500 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw protocol(`Invalid Focus ${name}.`);
  }
  return value;
}

function cursorField(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(value)) {
    throw protocol("Invalid Focus history cursor.");
  }
  return value;
}

function numberField(value: unknown, name: string, nullable = false): number | null {
  if (value === null && nullable) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw protocol(`Invalid Focus ${name}.`);
  return value;
}

function booleanField(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw protocol(`Invalid Focus ${name}.`);
  return value;
}

function session(value: unknown): FocusSessionDto {
  const item = record(value, "session");
  stringField(item.id, "session ID", { uuid: true });
  stringField(item.planId, "plan ID", { uuid: true });
  stringField(item.planItemId, "plan item ID", { uuid: true });
  opaqueIdentifierField(item.lectureId, "lecture ID");
  if (typeof item.status !== "string" || !SESSION_STATES.has(item.status)) throw protocol("Invalid Focus session status.");
  for (const name of ["startedAt", "plannedEndAt", "actualEndedAt", "lastCheckpointAt"] as const) {
    stringField(item[name], name, { nullable: true });
  }
  for (const name of ["activeSeconds", "pauseSeconds", "elapsedActiveSeconds", "remainingSeconds"] as const) {
    numberField(item[name], name, true);
  }
  stringField(item.serverNow, "serverNow");
  numberField(item.sessionNumber, "sessionNumber");
  numberField(item.plannedSessionCount, "plannedSessionCount");
  booleanField(item.isLastPlannedSession, "isLastPlannedSession");
  booleanField(item.completionEligible, "completionEligible");
  booleanField(item.reconciliationRequired, "reconciliationRequired");
  if (
    item.completionReason !== null &&
    (typeof item.completionReason !== "string" || !item.completionReason.trim())
  ) {
    throw protocol("Invalid Focus completion reason.");
  }
  return item as unknown as FocusSessionDto;
}

function planResource(value: unknown) {
  const item = record(value, "plan resource");
  if (
    typeof item.resourceType !== "string" ||
    !["PDF", "NOTE", "MCQ_SET", "FLASHCARD_SET", "VIDEO"].includes(item.resourceType)
  ) {
    throw protocol("Invalid Focus plan resource type.");
  }
  opaqueIdentifierField(item.resourceId, "plan resource ID");
  const sequence = numberField(item.sequence, "plan resource sequence");
  if (sequence === null || sequence < 1) throw protocol("Invalid Focus plan resource sequence.");
  return item;
}

function planItem(value: unknown): FocusPlanItemDto {
  const item = record(value, "plan item");
  stringField(item.id, "plan item ID", { uuid: true });
  opaqueIdentifierField(item.lectureId, "lecture ID");
  for (const name of ["sequence", "sessionCount", "focusDurationSeconds", "breakDurationSeconds"]) numberField(item[name], name);
  for (const name of ["includeMcq", "includeFlashcards", "includeVideo"]) booleanField(item[name], name);
  if (item.resources === undefined) item.resources = [];
  if (!Array.isArray(item.resources)) throw protocol("Invalid Focus plan resources.");
  item.resources = item.resources.map(planResource);
  return item as unknown as FocusPlanItemDto;
}

function plan(value: unknown): FocusPlanDto {
  const item = record(value, "plan");
  stringField(item.id, "plan ID", { uuid: true });
  if (typeof item.title !== "string" || !item.title || typeof item.status !== "string" || !item.status) {
    throw protocol("Invalid Focus plan fields.");
  }
  if (typeof item.timezone !== "string" || !item.timezone) throw protocol("Invalid Focus plan timezone.");
  numberField(item.planVersion, "planVersion");
  stringField(item.createdAt, "createdAt");
  stringField(item.updatedAt, "updatedAt");
  stringField(item.archivedAt, "archivedAt", { nullable: true });
  if (!Array.isArray(item.items)) throw protocol("Invalid Focus plan items.");
  return { ...item, items: item.items.map(planItem) } as FocusPlanDto;
}

const METRIC_PERIODS = new Set(["today", "last7Days", "month"]);

function focusMetrics(value: unknown): FocusMetricsDto {
  const item = record(value, "metrics response");
  if (typeof item.period !== "string" || !METRIC_PERIODS.has(item.period)) {
    throw protocol("Invalid Focus metrics period.");
  }
  if (item.timezone !== "Asia/Baghdad") throw protocol("Invalid Focus metrics timezone.");
  for (const name of ["startDate", "endDate"] as const) {
    if (typeof item[name] !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(item[name])) {
      throw protocol("Invalid Focus metrics date range.");
    }
  }
  const counters = (value: unknown, name: string) => {
    const fields = record(value, name);
    for (const key of ["focusSeconds", "sessionsCompleted", "interruptionCount"] as const) {
      numberField(fields[key], key);
    }
    return fields as unknown as FocusMetricsDto["totals"];
  };
  const totals = counters(item.totals, "metrics totals");
  if (!Array.isArray(item.daily)) throw protocol("Invalid Focus daily metrics.");
  const daily = item.daily.map((value) => {
    const entry = record(value, "daily metric");
    if (typeof entry.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(entry.date)) {
      throw protocol("Invalid Focus daily metric date.");
    }
    return { date: entry.date, ...counters(entry, "daily metric counters") };
  });
  return {
    period: item.period as FocusMetricsDto["period"],
    timezone: "Asia/Baghdad",
    startDate: item.startDate as string,
    endDate: item.endDate as string,
    totals,
    daily,
  };
}

function postFocusActionContext(value: unknown): PostFocusActionContext {
  const item = record(value, "post-Focus action context");
  for (const name of ["sessionId", "planId", "planItemId"] as const) {
    stringField(item[name], name, { uuid: true });
  }
  opaqueIdentifierField(item.lectureId, "lectureId");
  for (const name of ["sessionNumber", "plannedSessionCount"] as const) numberField(item[name], name);
  booleanField(item.isLastPlannedSession, "isLastPlannedSession");
  booleanField(item.manualLectureCompletionRequired, "manualLectureCompletionRequired");
  const actions = (value: unknown, name: string) => {
    const result = record(value, name);
    for (const action of ["mcq", "flashcards", "video"] as const) {
      booleanField(result[action], `${name}.${action}`);
    }
    return {
      mcq: result.mcq as boolean,
      flashcards: result.flashcards as boolean,
      video: result.video as boolean,
    };
  };
  return {
    sessionId: item.sessionId as string,
    lectureId: item.lectureId as string,
    planId: item.planId as string,
    planItemId: item.planItemId as string,
    sessionNumber: item.sessionNumber as number,
    plannedSessionCount: item.plannedSessionCount as number,
    isLastPlannedSession: item.isLastPlannedSession as boolean,
    manualLectureCompletionRequired: item.manualLectureCompletionRequired as boolean,
    configured: actions(item.configured, "configured actions"),
    available: actions(item.available, "available actions"),
  };
}

function mutation(value: unknown): FocusSessionMutationResult {
  const item = record(value, "mutation response");
  const result = session(item.session);
  const nextSession = item.nextSession === undefined
    ? undefined
    : session(item.nextSession);
  if (typeof item.idempotency !== "string" || !IDEMPOTENCY_RESULTS.has(item.idempotency)) {
    throw protocol("Invalid Focus idempotency result.");
  }
  if (item.manualLectureCompletionRequired !== undefined) booleanField(item.manualLectureCompletionRequired, "manualLectureCompletionRequired");
  if (item.followUpPreferences !== undefined) {
    const preferences = record(item.followUpPreferences, "follow-up preferences");
    for (const name of ["includeMcq", "includeFlashcards", "includeVideo"]) booleanField(preferences[name], name);
  }
  return {
    ...item,
    session: result,
    ...(nextSession ? { nextSession } : {}),
  } as unknown as FocusSessionMutationResult;
}

function interruption(value: unknown): FocusInterruptionResult {
  const item = record(value, "interruption response");
  if (item.idempotency !== "FIRST_SEEN" && item.idempotency !== "REPLAY_SAME_PAYLOAD") {
    throw protocol("Invalid Focus interruption idempotency result.");
  }
  return item as unknown as FocusInterruptionResult;
}

function current(value: unknown): FocusCurrentSessionResult {
  const item = record(value, "current-session response");
  if (item.session === undefined) throw protocol("Invalid current Focus session.");
  if (item.session !== null) session(item.session);
  stringField(item.serverNow, "serverNow");
  return item as unknown as FocusCurrentSessionResult;
}

function focusBreak(value: unknown): FocusBreakDto {
  const item = record(value, "break");
  stringField(item.id, "break ID", { uuid: true });
  stringField(item.focusSessionId, "break session ID", { uuid: true });
  const durationSeconds = numberField(item.durationSeconds, "break duration") as number;
  const remainingSeconds = numberField(item.remainingSeconds, "break remaining time") as number;
  if (
    !Number.isSafeInteger(durationSeconds) ||
    durationSeconds < 0 ||
    !Number.isSafeInteger(remainingSeconds) ||
    remainingSeconds < 0
  ) {
    throw protocol("Invalid Focus break duration.");
  }
  const startedAt = stringField(item.startedAt, "break startedAt") as string;
  const endsAt = stringField(item.endsAt, "break endsAt") as string;
  const startedAtMs = Date.parse(startedAt);
  const endsAtMs = Date.parse(endsAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endsAtMs) || endsAtMs < startedAtMs) {
    throw protocol("Invalid Focus break range.");
  }
  const endedAt = stringField(item.endedAt, "break endedAt", { nullable: true });
  if (endedAt !== null && !Number.isFinite(Date.parse(endedAt as string))) {
    throw protocol("Invalid Focus break end time.");
  }
  booleanField(item.resumeStudyOnReturn, "resumeStudyOnReturn");
  booleanField(item.isPaused, "isPaused");
  return item as unknown as FocusBreakDto;
}

function focusBreakSnapshot(value: unknown): FocusBreakSnapshot {
  const item = record(value, "break snapshot");
  const currentSession = session(item.session);
  if (item.breakSession !== null) focusBreak(item.breakSession);
  const serverNow = stringField(item.serverNow, "serverNow") as string;
  if (!Number.isFinite(Date.parse(serverNow))) throw protocol("Invalid Focus break server time.");
  return {
    session: currentSession,
    breakSession: item.breakSession === null ? null : item.breakSession as FocusBreakDto,
    serverNow,
  };
}

function focusBreakMutation(value: unknown): FocusBreakMutationResult {
  const item = record(value, "break mutation");
  const snapshot = focusBreakSnapshot(item);
  if (!snapshot.breakSession) throw protocol("Focus break mutation did not return a break.");
  if (!["FIRST_SEEN", "REPLAY_SAME_PAYLOAD", "ALREADY_ACTIVE", "ALREADY_ENDED"].includes(String(item.idempotency))) {
    throw protocol("Invalid Focus break idempotency result.");
  }
  return {
    ...snapshot,
    breakSession: snapshot.breakSession,
    idempotency: item.idempotency as FocusBreakMutationResult["idempotency"],
  };
}

function nullableDateField(value: unknown, name: string): string | null {
  if (value === null) return null;
  stringField(value, name);
  if (!Number.isFinite(Date.parse(value as string))) throw protocol(`Invalid ${name}.`);
  return value as string;
}

function textField(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw protocol(`Invalid ${name}.`);
  return value;
}

function focusSessionSummary(value: unknown): FocusSessionSummaryDto {
  const item = record(value, "Focus session summary");
  stringField(item.sessionId, "sessionId", { uuid: true });
  if (typeof item.status !== "string" || !SESSION_STATES.has(item.status)) {
    throw protocol("Invalid Focus summary status.");
  }
  const plan = record(item.plan, "summary plan");
  stringField(plan.id, "plan.id", { uuid: true });
  textField(plan.title, "plan.title");
  textField(plan.status, "plan.status");
  const lecture = record(item.lecture, "summary lecture");
  opaqueIdentifierField(lecture.id, "lecture.id");
  textField(lecture.title, "lecture.title");
  textField(lecture.subject, "lecture.subject");
  const progress = record(item.progress, "summary progress");
  for (const field of [
    "sessionNumber",
    "plannedSessionCount",
    "completedSessions",
    "totalPlannedSessions",
  ] as const) numberField(progress[field], `progress.${field}`);
  booleanField(progress.isLastPlannedSession, "progress.isLastPlannedSession");
  const timing = record(item.timing, "summary timing");
  for (const field of ["plannedFocusSeconds", "plannedBreakSeconds"] as const) {
    numberField(timing[field], `timing.${field}`);
  }
  if (timing.verifiedFocusSeconds !== null) {
    numberField(timing.verifiedFocusSeconds, "timing.verifiedFocusSeconds");
  }
  nullableDateField(timing.startedAt, "timing.startedAt");
  nullableDateField(timing.terminalAt, "timing.terminalAt");
  let points: FocusSessionSummaryDto["points"] = null;
  if (item.points !== null) {
    const pointData = record(item.points, "summary points");
    numberField(pointData.amount, "points.amount");
    textField(pointData.reasonCode, "points.reasonCode");
    points = {
      amount: pointData.amount as number,
      reasonCode: pointData.reasonCode as string,
    };
  }
  const resources = record(item.resources, "summary resources");
  numberField(resources.launchCount, "resources.launchCount");
  numberField(resources.uniqueResourceCount, "resources.uniqueResourceCount");
  if (!Array.isArray(resources.items)) throw protocol("Invalid summary resources.");
  const resourceItems = resources.items.map((value) => {
    const entry = record(value, "resource summary item");
    opaqueIdentifierField(entry.resourceId, "resourceId");
    if (entry.resourceType !== "PDF" && entry.resourceType !== "VIDEO") {
      throw protocol("Invalid resource type in summary.");
    }
    if (entry.title !== null) textField(entry.title, "resource title");
    numberField(entry.launchCount, "resource launch count");
    return {
      resourceId: entry.resourceId as string,
      resourceType: entry.resourceType as "PDF" | "VIDEO",
      title: entry.title as string | null,
      launchCount: entry.launchCount as number,
    };
  });
  const nextAction = record(item.nextAction, "summary next action");
  if (!["NEXT_SESSION", "NEXT_LECTURE", "PLAN_FINISHED", "UNAVAILABLE"].includes(String(nextAction.kind))) {
    throw protocol("Invalid summary next action.");
  }
  if (nextAction.planItemId !== null) {
    stringField(nextAction.planItemId, "nextAction.planItemId", { uuid: true });
  }
  if (nextAction.lectureId !== null) {
    opaqueIdentifierField(nextAction.lectureId, "nextAction.lectureId");
  }
  if (nextAction.lectureTitle !== null) textField(nextAction.lectureTitle, "nextAction.lectureTitle");
  return {
    sessionId: item.sessionId as string,
    status: item.status as FocusSessionSummaryDto["status"],
    plan: {
      id: plan.id as string,
      title: plan.title as string,
      status: plan.status as string,
    },
    lecture: {
      id: lecture.id as string,
      title: lecture.title as string,
      subject: lecture.subject as string,
    },
    progress: {
      sessionNumber: progress.sessionNumber as number,
      plannedSessionCount: progress.plannedSessionCount as number,
      isLastPlannedSession: progress.isLastPlannedSession as boolean,
      completedSessions: progress.completedSessions as number,
      totalPlannedSessions: progress.totalPlannedSessions as number,
    },
    timing: {
      plannedFocusSeconds: timing.plannedFocusSeconds as number,
      verifiedFocusSeconds: timing.verifiedFocusSeconds as number | null,
      plannedBreakSeconds: timing.plannedBreakSeconds as number,
      startedAt: timing.startedAt as string | null,
      terminalAt: timing.terminalAt as string | null,
    },
    points,
    resources: {
      launchCount: resources.launchCount as number,
      uniqueResourceCount: resources.uniqueResourceCount as number,
      items: resourceItems,
    },
    nextAction: {
      kind: nextAction.kind as FocusSessionSummaryDto["nextAction"]["kind"],
      planItemId: nextAction.planItemId as string | null,
      lectureId: nextAction.lectureId as string | null,
      lectureTitle: nextAction.lectureTitle as string | null,
    },
  };
}

function focusHistoryPage(value: unknown): FocusHistoryPageDto {
  const item = record(value, "Focus history page");
  numberField(item.limit, "history limit");
  if (item.nextCursor !== null) cursorField(item.nextCursor);
  if (!Array.isArray(item.items)) throw protocol("Invalid Focus history items.");
  const items = item.items.map((value) => {
    const row = record(value, "Focus history row");
    stringField(row.sessionId, "sessionId", { uuid: true });
    if (typeof row.status !== "string" || !SESSION_STATES.has(row.status)) {
      throw protocol("Invalid Focus history status.");
    }
    for (const field of ["planId", "planItemId"] as const) {
      stringField(row[field], field, { uuid: true });
    }
    opaqueIdentifierField(row.lectureId, "lectureId");
    for (const field of ["planTitle", "planStatus", "lectureTitle", "subject"] as const) {
      textField(row[field], field);
    }
    for (const field of [
      "plannedFocusSeconds",
      "resourceLaunchCount",
      "uniqueResourceCount",
    ] as const) numberField(row[field], field);
    if (row.verifiedFocusSeconds !== null) numberField(row.verifiedFocusSeconds, "verifiedFocusSeconds");
    if (row.points !== null) numberField(row.points, "points");
    return {
      sessionId: row.sessionId as string,
      status: row.status as FocusHistoryPageDto["items"][number]["status"],
      planId: row.planId as string,
      planTitle: row.planTitle as string,
      planStatus: row.planStatus as string,
      planItemId: row.planItemId as string,
      lectureId: row.lectureId as string,
      lectureTitle: row.lectureTitle as string,
      subject: row.subject as string,
      plannedFocusSeconds: row.plannedFocusSeconds as number,
      verifiedFocusSeconds: row.verifiedFocusSeconds as number | null,
      startedAt: nullableDateField(row.startedAt, "startedAt"),
      terminalAt: nullableDateField(row.terminalAt, "terminalAt"),
      points: row.points as number | null,
      resourceLaunchCount: row.resourceLaunchCount as number,
      uniqueResourceCount: row.uniqueResourceCount as number,
    };
  });
  return {
    items,
    limit: item.limit as number,
    nextCursor: item.nextCursor as string | null,
  };
}

async function json<T>(request: Requester, path: string, options: FocusApiRequestOptions, validate: (value: unknown) => T): Promise<T> {
  let response: Response;
  try {
    response = await request(path, options);
  } catch (error) {
    if (error instanceof FocusApiError) throw error;
    const candidate = error as { status?: unknown; body?: unknown; message?: unknown };
    if (typeof candidate.status === "number") {
      const body = candidate.body && typeof candidate.body === "object" && !Array.isArray(candidate.body)
        ? candidate.body as Record<string, unknown>
        : {};
      const code = typeof body.code === "string" ? body.code : undefined;
      const status = candidate.status;
      throw new FocusApiError(
        "http",
        code || "Focus request was rejected.",
        code || `HTTP_${status}`,
        typeof status === "number" ? status : undefined,
      );
    }
    throw new FocusApiError("transport", "Focus request could not be completed.", "TRANSPORT_ERROR");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw protocol("Focus server returned malformed JSON.");
  }
  if (!response.ok) {
    const errorBody = record(body, "error response");
    const code = typeof errorBody.code === "string" ? errorBody.code : undefined;
    throw new FocusApiError("http", code || "Focus request was rejected.", code || `HTTP_${response.status}`, response.status);
  }
  return validate(body);
}

const requestOptions = (method?: string, body?: unknown): FocusApiRequestOptions => ({
  ...(method ? { method } : {}),
  ...(method ? {
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      "X-Focus-Client-ID": getFocusClientInstanceId(),
    },
  } : {}),
  ...(body === undefined ? {} : {
    body: JSON.stringify(body),
  }),
  bypassCache: true,
  retries: 0,
  timeoutMs: 15_000,
});

function itemBody(item: CreateFocusPlanInput["items"][number], includeId: boolean): Record<string, unknown> {
  return {
    ...(includeId && item.id ? { id: item.id } : {}),
    lectureId: item.lectureId,
    sequence: item.sequence,
    sessionCount: item.sessionCount,
    focusDurationSeconds: item.focusDurationSeconds,
    breakDurationSeconds: item.breakDurationSeconds,
    includeMcq: item.includeMcq,
    includeFlashcards: item.includeFlashcards,
    includeVideo: item.includeVideo,
    resources: item.resources ?? [],
  };
}

export function createFocusApi(request: Requester = apiClient): FocusApi {
  const call = async <T>(
    path: string,
    options: FocusApiRequestOptions,
    validate: (value: unknown) => T,
  ) => {
    const result = await json(request, path, options, validate);
    if ((options.method ?? "GET").toUpperCase() !== "GET") {
      invalidateFocusResources(resourcesForFocusMutation(path, result));
    }
    return result;
  };
  const read = <T>(
    scope: string,
    variant: string,
    path: string,
    options: FocusApiRequestOptions,
    validate: (value: unknown) => T,
  ) => readFocusResource(scope, variant, (requestKey) =>
    json(request, path, { ...options, requestKey }, validate));
  const planBody = (input: CreateFocusPlanInput | UpdateFocusPlanInput, includeId: boolean) => ({
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    ...(input.items !== undefined ? { items: input.items.map((item) => itemBody(item, includeId)) } : {}),
  });
  return {
    getCurrentFocusSession: () => read(
      "current-session",
      "current",
      "/api/focus/sessions/current",
      requestOptions(),
      current,
    ),
    startFocusSession: (input) => call("/api/focus/sessions/start", requestOptions("POST", {
      planId: input.planId, planItemId: input.planItemId, idempotencyKey: input.idempotencyKey, source: input.source,
    }), mutation),
    pauseFocusSession: (id, input) => call(`/api/focus/sessions/${encodeURIComponent(id)}/pause`, requestOptions("POST", {
      idempotencyKey: input.idempotencyKey, source: input.source,
    }), mutation),
    resumeFocusSession: (id, input) => call(`/api/focus/sessions/${encodeURIComponent(id)}/resume`, requestOptions("POST", {
      idempotencyKey: input.idempotencyKey, source: input.source,
    }), mutation),
    getFocusBreak: (id) => read(
      `break:${id}`,
      id,
      `/api/focus/sessions/${encodeURIComponent(id)}/break`,
      requestOptions(),
      focusBreakSnapshot,
    ),
    startFocusBreak: (id, input) => call(`/api/focus/sessions/${encodeURIComponent(id)}/break/start`, requestOptions("POST", {
      idempotencyKey: input.idempotencyKey, source: input.source,
    }), focusBreakMutation),
    pauseFocusBreak: (id, input) => call(`/api/focus/sessions/${encodeURIComponent(id)}/break/pause`, requestOptions("POST", {
      idempotencyKey: input.idempotencyKey, source: input.source,
    }), focusBreakMutation),
    resumeFocusBreak: (id, input) => call(`/api/focus/sessions/${encodeURIComponent(id)}/break/resume`, requestOptions("POST", {
      idempotencyKey: input.idempotencyKey, source: input.source,
    }), focusBreakMutation),
    returnFromFocusBreak: (id, input) => call(`/api/focus/sessions/${encodeURIComponent(id)}/break/return`, requestOptions("POST", {
      idempotencyKey: input.idempotencyKey, source: input.source,
    }), focusBreakMutation),
    completeFocusSession: (id, input) => call(`/api/focus/sessions/${encodeURIComponent(id)}/complete`, requestOptions("POST", {
      idempotencyKey: input.idempotencyKey,
    }), mutation),
    abandonFocusSession: (id, input) => call(`/api/focus/sessions/${encodeURIComponent(id)}/abandon`, requestOptions("POST", {
      idempotencyKey: input.idempotencyKey, ...(input.reason !== undefined ? { reason: input.reason } : {}),
    }), mutation),
    startResourceHandoff: (id, input) => call(`/api/focus/sessions/${encodeURIComponent(id)}/handoff/start`, requestOptions("POST", {
      resourceType: input.resourceType, resourceId: input.resourceId,
      idempotencyKey: input.idempotencyKey, source: input.source,
    }), mutation),
    returnFromResourceHandoff: (id, input) => call(`/api/focus/sessions/${encodeURIComponent(id)}/handoff/return`, requestOptions("POST", {
      idempotencyKey: input.idempotencyKey, source: input.source, targetState: input.targetState,
    }), mutation),
    recordInterruption: (id, input) => call(`/api/focus/sessions/${encodeURIComponent(id)}/interruptions`, requestOptions("POST", {
      observedAwaySeconds: input.observedAwaySeconds, reason: input.reason,
      idempotencyKey: input.idempotencyKey, source: input.source,
    }), interruption),
    createFocusPlan: (input) => call("/api/focus/plans", requestOptions("POST", planBody(input, false)), (body) => plan(record(body, "plan response").plan)),
    listFocusPlans: (limit, options = {}) => {
      const params = new URLSearchParams();
      if (limit !== undefined) params.set("limit", String(limit));
      if (options.status) params.set("status", options.status);
      if (options.canonical) params.set("canonical", "1");
      const query = params.toString();
      const suffix = query ? `?${query}` : "";
      return read("plans", suffix, `/api/focus/plans${suffix}`, requestOptions(), (body) => {
        const result = record(body, "plan list response");
        if (!Array.isArray(result.plans)) throw protocol("Invalid Focus plan list.");
        return result.plans.map(plan);
      });
    },
    getFocusPlan: (id, options = {}) => {
      const suffix = options.canonical ? "?canonical=1" : "";
      return read(
        `plan:${id}`,
        suffix,
        `/api/focus/plans/${encodeURIComponent(id)}${suffix}`,
        requestOptions(),
        (body) => plan(record(body, "plan response").plan),
      );
    },
    updateFocusPlan: (id, input) => call(`/api/focus/plans/${encodeURIComponent(id)}`, requestOptions("PATCH", planBody(input, true)), (body) => plan(record(body, "plan response").plan)),
    archiveFocusPlan: (id) => call(`/api/focus/plans/${encodeURIComponent(id)}/archive`, requestOptions("POST"), (body) => plan(record(body, "plan response").plan)),
    getMetrics: (period) => read(
      "metrics",
      period,
      `/api/focus/metrics?period=${encodeURIComponent(period)}`,
      requestOptions(),
      focusMetrics,
    ),
    getPostFocusActionContext: (id) => read(
      `post-actions:${id}`,
      id,
      `/api/focus/sessions/${encodeURIComponent(id)}/post-actions`,
      requestOptions(),
      postFocusActionContext,
    ),
    getSessionSummary: (id) => read(
      `summary:${id}`,
      id,
      `/api/focus/sessions/${encodeURIComponent(id)}/summary`,
      requestOptions(),
      focusSessionSummary,
    ),
    listHistory: (query = {}) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) params.set(key, String(value));
      }
      const suffix = params.size ? `?${params.toString()}` : "";
      return read("history", suffix, `/api/focus/history${suffix}`, requestOptions(), focusHistoryPage);
    },
  };
}

export const focusApi = createFocusApi();