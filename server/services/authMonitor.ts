/**
 * Auth Monitor — 99's Guide Monitoring System
 *
 * Records authentication events without ever logging passwords,
 * raw tokens, or other sensitive credentials.
 */

import { logger } from "./logger.js";

/** Extracts a safe client identifier from the request (IP or forwarded IP). */
function safeIp(ip?: string): string {
  if (!ip) return "unknown";
  // Strip IPv6 loopback prefix
  return ip.replace(/^::ffff:/, "");
}

// ── Track failed login attempts for suspicious-activity detection ─────────────
const failedAttempts = new Map<string, { count: number; firstAt: number }>();
const SUSPICIOUS_THRESHOLD = 5;     // attempts
const SUSPICIOUS_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function trackFailedAttempt(key: string): number {
  const now = Date.now();
  const record = failedAttempts.get(key);

  if (!record || now - record.firstAt > SUSPICIOUS_WINDOW_MS) {
    failedAttempts.set(key, { count: 1, firstAt: now });
    return 1;
  }

  record.count += 1;
  return record.count;
}

function clearFailedAttempts(key: string) {
  failedAttempts.delete(key);
}

// ── Public API ────────────────────────────────────────────────────────────────

export const authMonitor = {
  /** Successful login */
  loginSuccess(userId: string, ip?: string) {
    const safeKey = userId; // clear per-user failure count on success
    clearFailedAttempts(safeKey);

    logger.info("AUTH", "Login successful", {
      userId,
      ip: safeIp(ip),
      details: { event: "LOGIN_SUCCESS" },
    });
  },

  /** Failed login attempt (wrong password or user not found) */
  loginFailed(emailHash: string, ip?: string, reason = "invalid_credentials") {
    const key = `${emailHash}:${safeIp(ip)}`;
    const count = trackFailedAttempt(key);

    logger.warn("AUTH", "Login failed", {
      ip: safeIp(ip),
      details: { event: "LOGIN_FAILED", reason, failedAttempts: count },
    });

    if (count >= SUSPICIOUS_THRESHOLD) {
      logger.warn("AUTH", "Suspicious login activity detected", {
        ip: safeIp(ip),
        details: {
          event: "SUSPICIOUS_LOGIN_ATTEMPTS",
          attempts: count,
          windowMinutes: SUSPICIOUS_WINDOW_MS / 60_000,
        },
      });
    }
  },

  /** Account registration succeeded */
  registrationSuccess(userId: string, ip?: string) {
    logger.info("AUTH", "New account registered", {
      userId,
      ip: safeIp(ip),
      details: { event: "REGISTRATION_SUCCESS" },
    });
  },

  /** Account registration failed (validation, duplicate, etc.) */
  registrationFailed(ip?: string, reason = "unknown") {
    logger.warn("AUTH", "Registration failed", {
      ip: safeIp(ip),
      details: { event: "REGISTRATION_FAILED", reason },
    });
  },

  /** User logged out */
  logout(userId?: string, ip?: string) {
    logger.info("AUTH", "User logged out", {
      userId: userId ?? null,
      ip: safeIp(ip),
      details: { event: "LOGOUT" },
    });
  },

  /** Banned account attempted login */
  bannedLoginAttempt(userId: string, ip?: string) {
    logger.warn("AUTH", "Banned account login attempt", {
      userId,
      ip: safeIp(ip),
      details: { event: "BANNED_LOGIN_ATTEMPT" },
    });
  },

  /** JWT verification failure (expired/tampered token) */
  tokenVerificationFailed(ip?: string, reason = "invalid_token") {
    logger.warn("AUTH", "Token verification failed", {
      ip: safeIp(ip),
      details: { event: "TOKEN_VERIFICATION_FAILED", reason },
    });
  },
};
