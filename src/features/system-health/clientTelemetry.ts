import { SYSTEM_HEALTH_FRONTEND_ENABLED } from "../../config/featureFlags";
import { apiClient } from "../../core/api/apiClient";

const ALLOWED_CODES = new Set(["CLIENT_RENDER_ERROR", "CLIENT_RUNTIME_ERROR"]);
const lastSentAt = new Map<string, number>();
const REPORT_INTERVAL_MS = 60_000;

export function reportSystemClientError(code: string): void {
  if (
    !SYSTEM_HEALTH_FRONTEND_ENABLED
    || typeof window === "undefined"
    || !ALLOWED_CODES.has(code)
  ) return;
  const now = Date.now();
  if (now - (lastSentAt.get(code) ?? 0) < REPORT_INTERVAL_MS) return;
  lastSentAt.set(code, now);

  void apiClient("/api/observability/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
    cache: "no-store",
    bypassCache: true,
    ttl: 0,
    retries: 0,
    silent: true,
  }).catch(() => undefined);
}