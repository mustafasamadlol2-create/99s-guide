/**
 * DB Monitor — 99's Guide Monitoring System
 *
 * Provides a Prisma query-event handler that logs:
 *  - Slow queries (>500 ms) as WARNING
 *  - Very slow queries (>2 000 ms) as ERROR
 *  - Query errors as ERROR
 *
 * Install by passing the `onQueryEvent` handler to the Prisma client's
 * $on('query', ...) callback after construction.
 *
 * Also exports helper wrappers for catching and logging DB-level errors
 * from outside Prisma middleware.
 */

import { logger } from "./logger.js";

const SLOW_QUERY_MS = 500;
const VERY_SLOW_QUERY_MS = 2_000;

/** Attach to `prisma.$on('query', dbMonitor.onQueryEvent)` */
export const dbMonitor = {
  /**
   * Called by Prisma for every executed query.
   * `event.duration` is in milliseconds.
   */
  onQueryEvent(event: { query: string; duration: number; target: string }) {
    const { duration, target } = event;

    if (duration >= VERY_SLOW_QUERY_MS) {
      logger.error("DATABASE", `Very slow query on ${target} (${duration}ms)`, {
        durationMs: duration,
        details: { target, event: "VERY_SLOW_QUERY" },
      });
    } else if (duration >= SLOW_QUERY_MS) {
      logger.warn("DATABASE", `Slow query on ${target} (${duration}ms)`, {
        durationMs: duration,
        details: { target, event: "SLOW_QUERY" },
      });
    }
  },

  /** Log a Prisma/database error that was caught at the route level */
  logQueryError(err: unknown, context: string, userId?: string | null) {
    const message =
      err instanceof Error ? err.message.substring(0, 120) : "Unknown DB error";

    // Classify connection problems
    const isConnectionError =
      message.toLowerCase().includes("connection") ||
      message.toLowerCase().includes("econnrefused") ||
      message.toLowerCase().includes("timeout");

    if (isConnectionError) {
      logger.critical("DATABASE", `Database connection error in ${context}`, {
        userId: userId ?? null,
        errorCode: "DB_CONNECTION_ERROR",
        details: { context, sanitizedMessage: message },
      });
    } else {
      logger.error("DATABASE", `Database error in ${context}`, {
        userId: userId ?? null,
        errorCode: "DB_QUERY_ERROR",
        details: { context, sanitizedMessage: message },
      });
    }
  },

  /** Log failed Supabase/Prisma health check */
  logHealthCheckFailed(err: unknown) {
    const message =
      err instanceof Error ? err.message.substring(0, 120) : "Unknown error";
    logger.critical("DATABASE", "Database health check failed", {
      errorCode: "DB_HEALTH_CHECK_FAILED",
      details: { sanitizedMessage: message },
    });
  },
};
