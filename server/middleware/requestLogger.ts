/**
 * Request Logger Middleware — 99's Guide Monitoring System
 *
 * Tracks every API request: method, endpoint, response status, duration.
 * Flags slow requests (>1 000 ms) as WARNING.
 * Skips static / binary routes to avoid noise.
 */

import express from "express";
import { logger } from "../services/logger.js";
import { recordEgress, recordHttpRequest, routeFamilyForPath } from "../observability/metrics.js";
import type { EgressCategory } from "../observability/types.js";

const SLOW_REQUEST_THRESHOLD_MS = 1_000;

/** Paths that produce noise and are not interesting for observability. */
const SKIP_PREFIXES = [
  "/uploads/",
  "/public/",
  "/prisma-studio",
  "/api/health",
  "/api/admin/health",
  "/api/observability/client-errors",
];

function shouldSkip(path: string): boolean {
  return SKIP_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function recordCompletedReadSources(res: express.Response): void {
  try {
    const categories = new Set<EgressCategory>();
    for (const name of res.getHeaderNames()) {
      const content = /^x-content(?:-[a-z-]+)?-read-source$/u.test(name) ||
        name === "x-material-metadata-read-source";
      const privateData = /^x-private-[a-z-]+-read-source$/u.test(name);
      if (!content && !privateData) continue;
      const source = res.getHeader(name);
      if (source === "d1") categories.add(content ? "content_d1_response" : "private_d1_response");
      else if (source === "supabase-fallback") {
        categories.add(content ? "content_postgres_fallback" : "private_postgres_fallback");
      } else if (source === "supabase") {
        categories.add(content ? "content_postgres_response" : "private_postgres_response");
      }
    }
    for (const category of categories) recordEgress(category);
  } catch {
    // Best effort. Header instrumentation never changes the response.
  }
}

export function requestLogger(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (!req.path.startsWith("/api") || shouldSkip(req.path)) {
    return next();
  }

  const startMs = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startMs;
    const statusCode = res.statusCode;
    const routeFamily = routeFamilyForPath(req.path);
    recordHttpRequest({ routeFamily, statusCode, durationMs });
    if ((req.method === "GET" || req.method === "HEAD") && statusCode >= 200 && statusCode < 300) {
      recordCompletedReadSources(res);
    }

    const meta = {
      method: req.method,
      endpoint: routeFamily,
      statusCode,
      durationMs,
    };

    if (statusCode >= 500) {
      logger.error("HTTP", `${req.method} ${routeFamily} → ${statusCode}`, {
        ...meta,
        errorCode: "HTTP_5XX",
      });
    } else if (statusCode >= 400) {
      // 401 on auth/me is a normal "unauthenticated session" check and should just be INFO
      if (statusCode === 401 && req.path === "/api/auth/me") {
        logger.info("HTTP", `${req.method} ${routeFamily} → ${statusCode}`, meta);
      } else {
        logger.warn("HTTP", `${req.method} ${routeFamily} → ${statusCode}`, meta);
      }
    } else if (durationMs > SLOW_REQUEST_THRESHOLD_MS) {
      logger.warn(
        "PERFORMANCE",
        `Slow request: ${req.method} ${routeFamily} took ${durationMs}ms`,
        meta
      );
    } else {
      logger.info("HTTP", `${req.method} ${routeFamily} → ${statusCode}`, meta);
    }
  });

  next();
}
