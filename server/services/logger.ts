/**
 * Structured Logger — 99's Guide Monitoring System
 *
 * Outputs JSON-structured log entries to stdout.
 * Keeps a circular in-memory buffer (last 1 000 entries) for admin introspection.
 * Never logs passwords, tokens, or raw secrets.
 */

import { redactLogValue, redactText } from "../observability/redaction.js";
import { OPERATIONAL_ERROR_CODES, type OperationalErrorCode } from "../observability/types.js";
import { recordOperationalOutcome } from "../observability/metrics.js";

export type LogLevel = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  userId?: string | null;
  endpoint?: string | null;
  method?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  ip?: string | null;
  errorCode?: string | null;
  appleAuth?: {
    flow?: "callback" | "popup" | "native" | "pkce" | "form_post";
    hasCodeChallenge?: boolean;
    provider?: "apple" | null;
    reason?:
      | "cancellation"
      | "authorization_pending"
      | "verified_email_required"
      | null;
    returnOrigin?: string | null;
    hasPrivateKey?: boolean;
    keyId?: string | null;
    httpStatus?: number | null;
    hasIdToken?: boolean;
    hasSub?: boolean;
    emailPresent?: boolean;
    emailVerified?: boolean | null;
    redirectUri?: string | null;
  };
  details?: Record<string, unknown> | null;
}

// ── In-memory circular buffer ─────────────────────────────────────────────────
const MAX_BUFFER = 1_000;
const logBuffer: LogEntry[] = [];

function pushToBuffer(entry: LogEntry) {
  if (logBuffer.length >= MAX_BUFFER) {
    logBuffer.shift();
  }
  logBuffer.push(entry);
}

/** Return recent log entries, optionally filtered by level */
export function getRecentLogs(limit = 100, level?: LogLevel): LogEntry[] {
  const entries = level
    ? logBuffer.filter((e) => e.level === level)
    : logBuffer;
  return entries.slice(-limit);
}

// ── Level weights (for filtering) ─────────────────────────────────────────────
const LEVEL_WEIGHT: Record<LogLevel, number> = {
  INFO: 0,
  WARNING: 1,
  ERROR: 2,
  CRITICAL: 3,
};

// ── Core emit function ────────────────────────────────────────────────────────
function emit(entry: LogEntry) {
  pushToBuffer(entry);
  if (entry.level === "ERROR" || entry.level === "CRITICAL") {
    try {
      const code = entry.errorCode as OperationalErrorCode | null | undefined;
      if (
        code
        && OPERATIONAL_ERROR_CODES.includes(code)
        && !["HTTP_5XX", "DB_CONNECTION_ERROR", "DB_QUERY_ERROR"].includes(code)
      ) {
        const feature = code === "STUDY_POINTS_LEDGER_INVARIANT"
          ? "study_points"
          : code === "STUDY_RECALL_ANSWER_FAILED"
            ? "recall"
            : code === "STUDY_MASTERY_REBUILD_FAILED"
              ? "mastery"
              : code === "STUDY_AI_PROVIDER_UNAVAILABLE"
                ? "ai_insights"
                : code === "STUDY_GROUP_RUNTIME_UNAVAILABLE"
                  ? "group_focus"
                  : code === "STUDY_OUTBOX_DELIVERY_FAILED" || code === "STUDY_D1_PROJECTION_STALE"
                    ? entry.category.toLowerCase().includes("leaderboard")
                      ? "leaderboard_d1"
                      : "private_d1"
                    : null;
        if (feature) {
          recordOperationalOutcome({
            feature,
            operation: feature === "ai_insights"
              ? "provider"
              : feature === "private_d1" || feature === "leaderboard_d1"
                ? "deliver"
                : feature === "mastery" ? "recompute" : "request",
            result: "failure",
            errorCode: code,
          });
        }
      }
    } catch {
      // Logging metrics are best-effort and must not affect application work.
    }
  }

  const weight = LEVEL_WEIGHT[entry.level];

  // In production emit all levels; in dev suppress INFO spam on health-check paths
  const isHealthCheck =
    entry.endpoint === "/api/health" || entry.endpoint === "/api/admin/health";
  if (isHealthCheck && entry.level === "INFO") return;

  if (weight >= LEVEL_WEIGHT.ERROR) {
    console.error(JSON.stringify(entry));
  } else if (weight === LEVEL_WEIGHT.WARNING) {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
function buildEntry(
  level: LogLevel,
  category: string,
  message: string,
  meta: Partial<Omit<LogEntry, "timestamp" | "level" | "category" | "message">> = {}
): LogEntry {
  const safeDetails = redactLogValue(meta.details ?? null) as Record<string, unknown> | null;
  return {
    timestamp: new Date().toISOString(),
    level,
    category: redactText(category),
    message: redactText(message),
    // Request identity and network address are not needed for operational
    // aggregates and must not be retained in the log buffer.
    userId: null,
    endpoint: meta.endpoint ? redactText(meta.endpoint) : null,
    method: meta.method ?? null,
    statusCode: meta.statusCode ?? null,
    durationMs: meta.durationMs ?? null,
    ip: null,
    errorCode: meta.errorCode ? redactText(meta.errorCode) : null,
    appleAuth: meta.appleAuth
      ? (redactLogValue(meta.appleAuth) as LogEntry["appleAuth"])
      : undefined,
    details: safeDetails,
  };
}

export const logger = {
  info(
    category: string,
    message: string,
    meta?: Partial<Omit<LogEntry, "timestamp" | "level" | "category" | "message">>
  ) {
    emit(buildEntry("INFO", category, message, meta));
  },

  warn(
    category: string,
    message: string,
    meta?: Partial<Omit<LogEntry, "timestamp" | "level" | "category" | "message">>
  ) {
    emit(buildEntry("WARNING", category, message, meta));
  },

  error(
    category: string,
    message: string,
    meta?: Partial<Omit<LogEntry, "timestamp" | "level" | "category" | "message">>
  ) {
    emit(buildEntry("ERROR", category, message, meta));
  },

  critical(
    category: string,
    message: string,
    meta?: Partial<Omit<LogEntry, "timestamp" | "level" | "category" | "message">>
  ) {
    emit(buildEntry("CRITICAL", category, message, meta));
  },
};
