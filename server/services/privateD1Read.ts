import { logger } from "./logger.js";
import { recordOperationalOutcome } from "../observability/metrics.js";
import {
  parseFocusPlanItems,
  type FocusPlanProjection,
  type FocusPlanProjectionItem,
  type FocusSessionProjection,
  type StudyDailyMetricProjection,
} from "../features/study-core/projection.js";

const PRIVATE_DATA_WORKER_BASE_URL = String(
  process.env.PRIVATE_DATA_WORKER_BASE_URL || ""
).trim().replace(/\/+$/, "");

const PRIVATE_DATA_SYNC_SECRET = String(
  process.env.PRIVATE_DATA_SYNC_SECRET || ""
).trim();

function envFlag(name: string): boolean {
  const value = String(process.env[name] || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function privateReadEnabled(flagName: string): boolean {
  return envFlag(flagName) &&
    PRIVATE_DATA_WORKER_BASE_URL.length > 0 &&
    PRIVATE_DATA_SYNC_SECRET.length > 0;
}

export async function fetchPrivateReadJson<T>(
  path: string,
  params: Record<string, string | number | null | undefined> = {},
): Promise<T> {
  if (!PRIVATE_DATA_WORKER_BASE_URL || !PRIVATE_DATA_SYNC_SECRET) {
    throw new Error("Private D1 read Worker is not configured.");
  }

  const url = new URL(path, `${PRIVATE_DATA_WORKER_BASE_URL}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && String(value).length > 0) {
      url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Private-Data-Sync-Secret": PRIVATE_DATA_SYNC_SECRET,
        "Cache-Control": "no-cache",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Private D1 read returned non-JSON HTTP ${response.status}.`);
    }

    if (!response.ok) {
      throw new Error(
        `Private D1 read HTTP ${response.status}: ${JSON.stringify(body).slice(0, 180)}`
      );
    }

    return body as T;
  } finally {
    clearTimeout(timeout);
  }
}

export function logPrivateReadFallback(scope: string, error: unknown): void {
  const failureCode = error instanceof PrivateD1ProjectionReadError
    ? error.code.toUpperCase().replace(/[^A-Z0-9_]/gu, "_")
    : "WORKER_UNAVAILABLE";
  recordOperationalOutcome({
    feature: "private_d1",
    operation: "fallback",
    result: "fallback",
  });
  logger.warn(
    "[PrivateD1Read]",
    `${scope} failed; falling back to PostgreSQL`,
    {
      errorCode: "STUDY_D1_PROJECTION_STALE",
      details: { failureCode },
    },
  );
}

export type FocusPlanReadProjection = Omit<FocusPlanProjection, "itemsJson"> & {
  items: FocusPlanProjectionItem[];
};

export class PrivateD1ProjectionReadError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "disabled"
      | "unavailable"
      | "malformed"
      | "scope-mismatch",
  ) {
    super(message);
    this.name = "PrivateD1ProjectionReadError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedUserId(userId: string): string {
  if (!userId.trim() || userId.length > 200) {
    throw new PrivateD1ProjectionReadError("Private projection user scope is invalid.", "scope-mismatch");
  }
  return userId;
}

function metadataRow(row: Record<string, unknown>, userId: string): void {
  if (
    typeof row.id !== "string" ||
    typeof row.canonicalId !== "string" ||
    row.id !== row.canonicalId ||
    typeof row.userId !== "string" ||
    row.userId !== userId ||
    typeof row.userScope !== "string" ||
    row.userScope !== userId ||
    typeof row.projectionVersion !== "number" ||
    !Number.isInteger(row.projectionVersion) ||
    typeof row.revision !== "string" ||
    !/^\d+$/.test(row.revision) ||
    typeof row.updatedAt !== "string" ||
    (row.deletedAt !== null && typeof row.deletedAt !== "string")
  ) {
    throw new PrivateD1ProjectionReadError("Private projection metadata is malformed.", "malformed");
  }
}

async function projectionRows<T>(
  flagName: string,
  path: string,
  userId: string,
  params: Record<string, string | number | null | undefined>,
  parse: (row: Record<string, unknown>, userId: string) => T,
): Promise<T[]> {
  const scope = boundedUserId(userId);
  if (!privateReadEnabled(flagName)) {
    throw new PrivateD1ProjectionReadError("Private projection reads are disabled.", "disabled");
  }

  let payload: unknown;
  try {
    payload = await fetchPrivateReadJson<unknown>(path, { ...params, userId: scope });
  } catch (error) {
    throw new PrivateD1ProjectionReadError(
      error instanceof Error ? error.message : "Private projection read failed.",
      "unavailable",
    );
  }

  if (!record(payload) || !Array.isArray(payload.rows)) {
    throw new PrivateD1ProjectionReadError("Private projection response is malformed.", "malformed");
  }

  try {
    return payload.rows.map((row) => {
      if (!record(row)) throw new Error("Projection row is not an object.");
      return parse(row, scope);
    });
  } catch (error) {
    if (error instanceof PrivateD1ProjectionReadError) throw error;
    throw new PrivateD1ProjectionReadError(
      error instanceof Error ? error.message : "Projection row is malformed.",
      "malformed",
    );
  }
}

export function fetchFocusPlanProjections(
  userId: string,
  options: { limit?: number } = {},
): Promise<FocusPlanReadProjection[]> {
  return projectionRows(
    "PRIVATE_D1_FOCUS_PLAN_READS_ENABLED",
    "/internal/private-read/focus-plans",
    userId,
    { limit: options.limit },
    (row, scope) => {
      metadataRow(row, scope);
      if (
        typeof row.title !== "string" ||
        typeof row.status !== "string" ||
        typeof row.timezone !== "string" ||
        typeof row.planVersion !== "number" ||
        typeof row.createdAt !== "string" ||
        typeof row.updatedAt !== "string" ||
        (row.archivedAt !== null && typeof row.archivedAt !== "string") ||
        typeof row.itemsJson !== "string"
      ) {
        throw new Error("Focus Plan projection is malformed.");
      }
      return {
        ...row,
        items: parseFocusPlanItems(row.itemsJson),
      } as FocusPlanReadProjection;
    },
  );
}

export function fetchFocusSessionProjections(
  userId: string,
  options: { status?: string; limit?: number } = {},
): Promise<FocusSessionProjection[]> {
  return projectionRows(
    "PRIVATE_D1_FOCUS_SESSION_READS_ENABLED",
    "/internal/private-read/focus-sessions",
    userId,
    { status: options.status, limit: options.limit },
    (row, scope) => {
      metadataRow(row, scope);
      const integerFields = [
        "activeSeconds",
        "pauseSeconds",
      ] as const;
      if (
        typeof row.planId !== "string" ||
        typeof row.planItemId !== "string" ||
        typeof row.lectureId !== "string" ||
        typeof row.status !== "string" ||
        integerFields.some((field) => typeof row[field] !== "number" || !Number.isInteger(row[field])) ||
        typeof row.updatedAt !== "string"
      ) {
        throw new Error("Focus Session projection is malformed.");
      }
      return row as FocusSessionProjection;
    },
  );
}

export function fetchStudyDailyMetricProjections(
  userId: string,
  options: { from?: string; to?: string; limit?: number } = {},
): Promise<StudyDailyMetricProjection[]> {
  return projectionRows(
    "PRIVATE_D1_STUDY_DAILY_METRIC_READS_ENABLED",
    "/internal/private-read/study-daily-metrics",
    userId,
    { from: options.from, to: options.to, limit: options.limit },
    (row, scope) => {
      metadataRow(row, scope);
      const counterFields = [
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
      if (
        typeof row.metricDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.metricDate) ||
        counterFields.some((field) => typeof row[field] !== "number" || !Number.isInteger(row[field])) ||
        typeof row.updatedAt !== "string"
      ) {
        throw new Error("Study Daily Metric projection is malformed.");
      }
      return row as StudyDailyMetricProjection;
    },
  );
}
