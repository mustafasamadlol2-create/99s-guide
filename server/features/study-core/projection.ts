export type ProjectionMetadata = {
  canonicalId: string;
  projectionVersion: number;
  revision: number | string;
  updatedAt: string;
  deletedAt?: string | null;
  userScope?: string | null;
  cohortScope?: string | null;
};

export type FocusPlanProjectionItem = {
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

export type FocusPlanProjection = ProjectionMetadata & {
  id: string;
  userId: string;
  title: string;
  status: string;
  timezone: string;
  planVersion: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  itemsJson: string;
};

export type FocusSessionProjection = ProjectionMetadata & {
  id: string;
  userId: string;
  planId: string;
  planItemId: string;
  lectureId: string;
  status: string;
  startedAt: string | null;
  plannedEndAt: string | null;
  actualEndedAt: string | null;
  lastCheckpointAt: string | null;
  activeSeconds: number;
  pauseSeconds: number;
  completionReason: string | null;
  updatedAt: string;
};

export type StudyDailyMetricProjection = ProjectionMetadata & {
  id: string;
  userId: string;
  metricDate: string;
  focusSeconds: number;
  sessionsCompleted: number;
  mcqAttempts: number;
  mcqCorrect: number;
  flashcardReviews: number;
  recallAttempts: number;
  recallCorrect: number;
  lectureCompletions: number;
  interruptionCount: number;
  updatedAt: string;
};

type DateLike = Date | string | null | undefined;

const MAX_FOCUS_PLAN_ITEMS = 500;
const MAX_FOCUS_PLAN_ITEMS_JSON_BYTES = 64 * 1024;

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 500) {
    throw new Error(`Projection field ${field} must be a bounded string.`);
  }
  return value;
}

function isoDate(value: DateLike, field: string, nullable = false): string | null {
  if (value === null || value === undefined) {
    if (nullable) return null;
    throw new Error(`Projection field ${field} is required.`);
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Projection field ${field} is invalid.`);
  return date.toISOString();
}

function logicalDate(value: DateLike): string {
  const normalized = isoDate(value, "metricDate");
  if (!normalized) throw new Error("Projection metricDate is required.");
  return normalized.slice(0, 10);
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) {
    throw new Error(`Projection field ${field} must be a bounded integer.`);
  }
  return Number(value);
}

function revision(value: number | string): number | string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Projection revision is invalid.");
    return value;
  }
  if (!/^\d+$/.test(value) || value.length > 40) throw new Error("Projection revision is invalid.");
  return value;
}

function metadata(
  canonicalId: string,
  userScope: string,
  updatedAt: DateLike,
  projectionRevision: number | string,
  projectionVersion = 1,
): ProjectionMetadata {
  return {
    canonicalId: requiredString(canonicalId, "canonicalId"),
    projectionVersion: integer(projectionVersion, "projectionVersion", 1),
    revision: revision(projectionRevision),
    updatedAt: isoDate(updatedAt, "updatedAt") as string,
    deletedAt: null,
    userScope: requiredString(userScope, "userScope"),
  };
}

function boundedItems(items: readonly FocusPlanProjectionItem[]): string {
  if (items.length > MAX_FOCUS_PLAN_ITEMS) {
    throw new Error(`Focus Plan contains more than ${MAX_FOCUS_PLAN_ITEMS} items.`);
  }
  const sorted = [...items]
    .map((item) => ({
      id: requiredString(item.id, "item.id"),
      lectureId: requiredString(item.lectureId, "item.lectureId"),
      sequence: integer(item.sequence, "item.sequence"),
      sessionCount: integer(item.sessionCount, "item.sessionCount"),
      focusDurationSeconds: integer(item.focusDurationSeconds, "item.focusDurationSeconds"),
      breakDurationSeconds: integer(item.breakDurationSeconds, "item.breakDurationSeconds"),
      includeMcq: Boolean(item.includeMcq),
      includeFlashcards: Boolean(item.includeFlashcards),
      includeVideo: Boolean(item.includeVideo),
    }))
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  const json = JSON.stringify(sorted);
  if (json.length > MAX_FOCUS_PLAN_ITEMS_JSON_BYTES) {
    throw new Error("Focus Plan items projection exceeds the bounded payload limit.");
  }
  return json;
}

export function buildFocusPlanProjection(input: {
  plan: {
    id: string;
    userId: string;
    title: string;
    status: string;
    timezone: string;
    planVersion: number;
    createdAt: DateLike;
    updatedAt: DateLike;
    archivedAt?: DateLike;
  };
  items: readonly (Omit<FocusPlanProjectionItem, "id"> & { id?: string })[];
  revision: number | string;
  projectionVersion?: number;
}): FocusPlanProjection {
  const plan = input.plan;
  const id = requiredString(plan.id, "id");
  const userId = requiredString(plan.userId, "userId");
  const items = input.items.map((item, index) => ({
    ...item,
    id: item.id ?? `${id}:item:${index}`,
  }));
  const updatedAt = isoDate(plan.updatedAt, "updatedAt");
  return {
    ...metadata(id, userId, updatedAt, input.revision, input.projectionVersion),
    id,
    userId,
    title: requiredString(plan.title, "title"),
    status: requiredString(plan.status, "status"),
    timezone: requiredString(plan.timezone, "timezone",),
    planVersion: integer(plan.planVersion, "planVersion", 1),
    createdAt: isoDate(plan.createdAt, "createdAt") as string,
    updatedAt: updatedAt as string,
    archivedAt: isoDate(plan.archivedAt, "archivedAt", true),
    itemsJson: boundedItems(items),
  };
}

export function buildFocusSessionProjection(input: {
  session: Omit<FocusSessionProjection, keyof ProjectionMetadata | "id" | "updatedAt"> & {
    id: string;
    updatedAt: DateLike;
  };
  revision: number | string;
  projectionVersion?: number;
}): FocusSessionProjection {
  const session = input.session;
  const id = requiredString(session.id, "id");
  const userId = requiredString(session.userId, "userId");
  return {
    ...metadata(id, userId, session.updatedAt, input.revision, input.projectionVersion),
    id,
    userId,
    planId: requiredString(session.planId, "planId"),
    planItemId: requiredString(session.planItemId, "planItemId"),
    lectureId: requiredString(session.lectureId, "lectureId"),
    status: requiredString(session.status, "status"),
    startedAt: isoDate(session.startedAt, "startedAt", true),
    plannedEndAt: isoDate(session.plannedEndAt, "plannedEndAt", true),
    actualEndedAt: isoDate(session.actualEndedAt, "actualEndedAt", true),
    lastCheckpointAt: isoDate(session.lastCheckpointAt, "lastCheckpointAt", true),
    activeSeconds: integer(session.activeSeconds, "activeSeconds"),
    pauseSeconds: integer(session.pauseSeconds, "pauseSeconds"),
    completionReason: session.completionReason === null
      ? null
      : requiredString(session.completionReason, "completionReason"),
    updatedAt: isoDate(session.updatedAt, "updatedAt") as string,
  };
}

export function buildStudyDailyMetricProjection(input: {
  metric: Omit<StudyDailyMetricProjection, keyof ProjectionMetadata | "id" | "updatedAt"> & {
    id: string;
    updatedAt: DateLike;
  };
  revision: number | string;
  projectionVersion?: number;
}): StudyDailyMetricProjection {
  const metric = input.metric;
  const id = requiredString(metric.id, "id");
  const userId = requiredString(metric.userId, "userId");
  return {
    ...metadata(id, userId, metric.updatedAt, input.revision, input.projectionVersion),
    id,
    userId,
    metricDate: logicalDate(metric.metricDate),
    focusSeconds: integer(metric.focusSeconds, "focusSeconds"),
    sessionsCompleted: integer(metric.sessionsCompleted, "sessionsCompleted"),
    mcqAttempts: integer(metric.mcqAttempts, "mcqAttempts"),
    mcqCorrect: integer(metric.mcqCorrect, "mcqCorrect"),
    flashcardReviews: integer(metric.flashcardReviews, "flashcardReviews"),
    recallAttempts: integer(metric.recallAttempts, "recallAttempts"),
    recallCorrect: integer(metric.recallCorrect, "recallCorrect"),
    lectureCompletions: integer(metric.lectureCompletions, "lectureCompletions"),
    interruptionCount: integer(metric.interruptionCount, "interruptionCount"),
    updatedAt: isoDate(metric.updatedAt, "updatedAt") as string,
  };
}

export function parseFocusPlanItems(itemsJson: string): FocusPlanProjectionItem[] {
  if (typeof itemsJson !== "string" || itemsJson.length > MAX_FOCUS_PLAN_ITEMS_JSON_BYTES) {
    throw new Error("Invalid Focus Plan items projection.");
  }
  const parsed: unknown = JSON.parse(itemsJson);
  if (!Array.isArray(parsed) || parsed.length > MAX_FOCUS_PLAN_ITEMS) {
    throw new Error("Invalid Focus Plan items projection.");
  }
  return parsed as FocusPlanProjectionItem[];
}