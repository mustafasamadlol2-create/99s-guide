/**
 * Request Logger Middleware — 99's Guide Monitoring System
 *
 * Tracks every API request: method, endpoint, response status, duration.
 * Flags slow requests (>1 000 ms) as WARNING.
 * Skips static / binary routes to avoid noise.
 */

import express from "express";
import { logger } from "../services/logger.js";

const SLOW_REQUEST_THRESHOLD_MS = 1_000;

/** Paths that produce noise and are not interesting for observability. */
const SKIP_PREFIXES = [
  "/uploads/",
  "/public/",
  "/prisma-studio",
  "/api/health",
  "/api/admin/health",
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
    const userId: string | null = (req as any).user?.id ?? null;
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      undefined;

    const meta = {
      method: req.method,
      endpoint: req.path,
      statusCode,
      durationMs,
      userId,
      ip,
    };

    if (statusCode >= 500) {
      logger.error("HTTP", `${req.method} ${req.path} → ${statusCode}`, meta);
    } else if (statusCode >= 400) {
      // 401 on auth/me is a normal "unauthenticated session" check and should just be INFO
      if (statusCode === 401 && req.path === "/api/auth/me") {
        logger.info("HTTP", `${req.method} ${req.path} → ${statusCode}`, meta);
      } else {
        logger.warn("HTTP", `${req.method} ${req.path} → ${statusCode}`, meta);
      }
    } else if (durationMs > SLOW_REQUEST_THRESHOLD_MS) {
      logger.warn(
        "PERFORMANCE",
        `Slow request: ${req.method} ${req.path} took ${durationMs}ms`,
        meta
      );
    } else {
      logger.info("HTTP", `${req.method} ${req.path} → ${statusCode}`, meta);
    }
  });

  next();
}
