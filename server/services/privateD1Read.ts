import { logger } from "./logger.js";

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
  const message = error instanceof Error ? error.message : String(error);
  logger.warn(
    "[PrivateD1Read]",
    `${scope} failed; falling back to Supabase: ${message.slice(0, 180)}`,
  );
}
