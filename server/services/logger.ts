/**
 * Structured Logger — 99's Guide Monitoring System
 *
 * Outputs JSON-structured log entries to stdout.
 * Keeps a circular in-memory buffer (last 1 000 entries) for admin introspection.
 * Never logs passwords, tokens, or raw secrets.
 */

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
  return {
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    userId: meta.userId ?? null,
    endpoint: meta.endpoint ?? null,
    method: meta.method ?? null,
    statusCode: meta.statusCode ?? null,
    durationMs: meta.durationMs ?? null,
    ip: meta.ip ?? null,
    errorCode: meta.errorCode ?? null,
    details: meta.details ?? null,
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
