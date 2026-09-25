import { apiClient } from "../../../core/api/apiClient";
import type {
  AbandonFocusSessionInput,
  CompleteFocusSessionInput,
  CreateFocusPlanInput,
  FocusSessionTransitionInput,
  StartFocusSessionInput,
  UpdateFocusPlanInput,
  CreateFocusQuickNoteInput,
  ConvertFocusQuickNoteInput,
  UpdateFocusQuickNoteInput,
  FocusQuickNoteListQuery,
  FocusMetricsPeriod,
} from "../../../../server/features/focus/schemas";
import type {
  FocusCurrentSessionResult,
  FocusMetricsDto,
  FocusQuickNoteCreateResult,
  FocusQuickNoteConversionResult,
  FocusQuickNoteDto,
  FocusPlanDto,
  FocusPlanItemDto,
  PostFocusActionContext,
  FocusSessionDto,
  FocusSessionMutationResult,
} from "../../../../server/features/focus/types";

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

export interface FocusApi {
  getCurrentFocusSession(): Promise<FocusCurrentSessionResult>;
  startFocusSession(input: StartFocusSessionInput): Promise<FocusSessionMutationResult>;
  pauseFocusSession(sessionId: string, input: FocusSessionTransitionInput): Promise<FocusSessionMutationResult>;
  resumeFocusSession(sessionId: string, input: FocusSessionTransitionInput): Promise<FocusSessionMutationResult>;
  completeFocusSession(sessionId: string, input: CompleteFocusSessionInput): Promise<FocusSessionMutationResult>;
  abandonFocusSession(sessionId: string, input: AbandonFocusSessionInput): Promise<FocusSessionMutationResult>;
  startResourceHandoff?(sessionId: string, input: ResourceHandoffStartInput): Promise<FocusSessionMutationResult>;
  returnFromResourceHandoff?(sessionId: string, input: ResourceHandoffReturnInput): Promise<FocusSessionMutationResult>;
  recordInterruption?(sessionId: string, input: RecordInterruptionInput): Promise<FocusInterruptionResult>;
  createFocusPlan(input: CreateFocusPlanInput): Promise<FocusPlanDto>;
  listFocusPlans(limit?: number): Promise<FocusPlanDto[]>;
  getFocusPlan(planId: string): Promise<FocusPlanDto>;
  updateFocusPlan(planId: string, input: UpdateFocusPlanInput): Promise<FocusPlanDto>;
  archiveFocusPlan(planId: string): Promise<FocusPlanDto>;
  createQuickNote(input: CreateFocusQuickNoteInput): Promise<FocusQuickNoteCreateResult>;
  listQuickNotes(query?: FocusQuickNoteListQuery): Promise<FocusQuickNoteDto[]>;
  getQuickNote(noteId: string): Promise<FocusQuickNoteDto>;
  updateQuickNote(noteId: string, input: UpdateFocusQuickNoteInput): Promise<FocusQuickNoteDto>;
  archiveQuickNote(noteId: string): Promise<FocusQuickNoteDto>;
  convertQuickNote(noteId: string, input: ConvertFocusQuickNoteInput): Promise<FocusQuickNoteConversionResult>;
  getMetrics(period: FocusMetricsPeriod): Promise<FocusMetricsDto>;
  getPostFocusActionContext(sessionId: string): Promise<PostFocusActionContext>;
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
  stringField(item.lectureId, "lecture ID", { uuid: true });
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
  stringField(item.completionReason, "completionReason", { nullable: true });
  return item as unknown as FocusSessionDto;
}

function planItem(value: unknown): FocusPlanItemDto {
  const item = record(value, "plan item");
  stringField(item.id, "plan item ID", { uuid: true });
  stringField(item.lectureId, "lecture ID", { uuid: true });
  for (const name of ["sequence", "sessionCount", "focusDurationSeconds", "breakDurationSeconds"]) numberField(item[name], name);
  for (const name of ["includeMcq", "includeFlashcards", "includeVideo"]) booleanField(item[name], name);
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

const NOTE_STATUSES = new Set(["ACTIVE", "ARCHIVED", "CONVERTED"]);
const METRIC_PERIODS = new Set(["today", "last7Days", "month"]);

function quickNote(value: unknown): FocusQuickNoteDto {
  const item = record(value, "quick note");
  stringField(item.id, "Quick Note ID", { uuid: true });
  stringField(item.focusSessionId, "Quick Note Session ID", { uuid: true });
  stringField(item.lectureId, "Quick Note Lecture ID", { uuid: true });
  if (typeof item.content !== "string" || !item.content.trim() ||
      Array.from(item.content).length > 2_000) {
    throw protocol("Invalid Quick Note content.");
  }
  if (typeof item.status !== "string" || !NOTE_STATUSES.has(item.status)) {
    throw protocol("Invalid Quick Note status.");
  }
  stringField(item.convertedToPlanItemId, "converted Plan item ID", { uuid: true, nullable: true });
  for (const name of ["createdAt", "updatedAt"] as const) stringField(item[name], name);
  for (const name of ["archivedAt", "convertedAt"] as const) {
    stringField(item[name], name, { nullable: true });
  }
  return item as unknown as FocusQuickNoteDto;
}

function quickNoteCreateResult(value: unknown): FocusQuickNoteCreateResult {
  const item = record(value, "Quick Note response");
  if (item.idempotency !== "CREATED" && item.idempotency !== "REPLAY_SAME_PAYLOAD") {
    throw protocol("Invalid Quick Note idempotency result.");
  }
  return { note: quickNote(item.note), idempotency: item.idempotency };
}

function quickNoteConversionResult(value: unknown): FocusQuickNoteConversionResult {
  const item = record(value, "Quick Note conversion response");
  if (item.idempotency !== "CONVERTED" && item.idempotency !== "REPLAY_SAME_PAYLOAD") {
    throw protocol("Invalid Quick Note conversion idempotency result.");
  }
  const converted = record(item.planItem, "converted Plan item");
  const parsedItem = planItem(converted);
  stringField(converted.planId, "converted Plan ID", { uuid: true });
  return {
    note: quickNote(item.note),
    planItem: { ...parsedItem, planId: converted.planId as string },
    idempotency: item.idempotency,
  };
}

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
  for (const name of ["sessionId", "lectureId", "planId", "planItemId"] as const) {
    stringField(item[name], name, { uuid: true });
  }
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
  if (typeof item.idempotency !== "string" || !IDEMPOTENCY_RESULTS.has(item.idempotency)) {
    throw protocol("Invalid Focus idempotency result.");
  }
  if (item.manualLectureCompletionRequired !== undefined) booleanField(item.manualLectureCompletionRequired, "manualLectureCompletionRequired");
  if (item.followUpPreferences !== undefined) {
    const preferences = record(item.followUpPreferences, "follow-up preferences");
    for (const name of ["includeMcq", "includeFlashcards", "includeVideo"]) booleanField(preferences[name], name);
  }
  return item as unknown as FocusSessionMutationResult;
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
  ...(body === undefined ? {} : {
    headers: { "Content-Type": "application/json" },
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
  };
}

let currentRequestGeneration = 0;

export function createFocusApi(request: Requester = apiClient): FocusApi {
  const call = <T>(path: string, options: FocusApiRequestOptions, validate: (value: unknown) => T) =>
    json(request, path, options, validate);
  const planBody = (input: CreateFocusPlanInput | UpdateFocusPlanInput, includeId: boolean) => ({
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    ...(input.items !== undefined ? { items: input.items.map((item) => itemBody(item, includeId)) } : {}),
  });
  return {
    getCurrentFocusSession: () => call(
      "/api/focus/sessions/current",
      { ...requestOptions(), requestKey: `focus-current-${++currentRequestGeneration}` },
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
    listFocusPlans: (limit) => call(`/api/focus/plans${limit === undefined ? "" : `?limit=${encodeURIComponent(String(limit))}`}`, requestOptions(), (body) => {
      const result = record(body, "plan list response");
      if (!Array.isArray(result.plans)) throw protocol("Invalid Focus plan list.");
      return result.plans.map(plan);
    }),
    getFocusPlan: (id) => call(`/api/focus/plans/${encodeURIComponent(id)}`, requestOptions(), (body) => plan(record(body, "plan response").plan)),
    updateFocusPlan: (id, input) => call(`/api/focus/plans/${encodeURIComponent(id)}`, requestOptions("PATCH", planBody(input, true)), (body) => plan(record(body, "plan response").plan)),
    archiveFocusPlan: (id) => call(`/api/focus/plans/${encodeURIComponent(id)}/archive`, requestOptions("POST"), (body) => plan(record(body, "plan response").plan)),
    createQuickNote: (input) => call("/api/focus/quick-notes", requestOptions("POST", {
      focusSessionId: input.focusSessionId,
      content: input.content,
      idempotencyKey: input.idempotencyKey,
    }), quickNoteCreateResult),
    listQuickNotes: (query = {}) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) params.set(key, String(value));
      }
      const suffix = params.size ? `?${params.toString()}` : "";
      return call(`/api/focus/quick-notes${suffix}`, requestOptions(), (body) => {
        const result = record(body, "Quick Note list response");
        if (!Array.isArray(result.notes)) throw protocol("Invalid Quick Note list.");
        return result.notes.map(quickNote);
      });
    },
    getQuickNote: (id) => call(
      `/api/focus/quick-notes/${encodeURIComponent(id)}`,
      requestOptions(),
      (body) => quickNote(record(body, "Quick Note response").note),
    ),
    updateQuickNote: (id, input) => call(
      `/api/focus/quick-notes/${encodeURIComponent(id)}`,
      requestOptions("PATCH", { content: input.content }),
      (body) => quickNote(record(body, "Quick Note response").note),
    ),
    archiveQuickNote: (id) => call(
      `/api/focus/quick-notes/${encodeURIComponent(id)}/archive`,
      requestOptions("POST"),
      (body) => quickNote(record(body, "Quick Note response").note),
    ),
    convertQuickNote: (id, input) => call(
      `/api/focus/quick-notes/${encodeURIComponent(id)}/convert-to-plan-item`,
      requestOptions("POST", { targetPlanId: input.targetPlanId }),
      quickNoteConversionResult,
    ),
    getMetrics: (period) => call(
      `/api/focus/metrics?period=${encodeURIComponent(period)}`,
      requestOptions(),
      focusMetrics,
    ),
    getPostFocusActionContext: (id) => call(
      `/api/focus/sessions/${encodeURIComponent(id)}/post-actions`,
      requestOptions(),
      postFocusActionContext,
    ),
  };
}

export const focusApi = createFocusApi();