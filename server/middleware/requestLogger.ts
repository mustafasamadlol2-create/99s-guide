/**
 * Request Logger Middleware — 99's Guide Monitoring System
 *
 * Tracks every API request: method, endpoint, response status, duration.
 * Flags slow requests (>1 000 ms) as WARNING.
 * Skips static / binary routes to avoid noise.
 */

import express from "express";
import { logger } from "../services/logger.js";
import { recordHttpRequest, routeFamilyForPath } from "../observability/metrics.js";

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
