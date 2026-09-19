import {
  MAX_PERSONALIZATION_CLOUD_RECORD_BYTES,
  parsePersonalizationConfig,
  type PersonalizationCloudRecord,
  type PersonalizationConfigV1,
} from "../../shared/personalization.js";

export type PersonalizationWorkerResult =
  | { status: "ok"; record: PersonalizationCloudRecord }
  | { status: "empty"; record: null }
  | { status: "disabled"; record: null };

export class PersonalizationSyncError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable = false,
    readonly retryAfter?: string,
  ) {
    super(message);
    this.name = "PersonalizationSyncError";
  }
}

export function personalizationCloudSyncEnabled(): boolean {
  return process.env.PERSONALIZATION_CLOUD_SYNC_ENABLED === "true";
}

function workerUrl(): string {
  return String(process.env.PERSONALIZATION_WORKER_URL || "").trim().replace(/\/+$/, "");
}

function requireWorkerConfig(): { url: string; secret: string } {
  const url = workerUrl();
  const secret = String(process.env.PERSONALIZATION_SYNC_SECRET || "").trim();
  if (!url || !secret) throw new PersonalizationSyncError("Personalization sync is unavailable.", 503, true);
  return { url, secret };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateRecord(value: unknown): PersonalizationCloudRecord | null {
  if (!isRecord(value)) return null;
  const config = parsePersonalizationConfig(value.config);
  if (value.recordVersion !== 1 || !config || typeof value.revision !== "string" || !value.revision ||
      typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)) ||
      typeof value.lastIntentId !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/.test(value.lastIntentId)) {
    return null;
  }
  const record = {
    recordVersion: 1 as const,
    config,
    revision: value.revision,
    updatedAt: value.updatedAt,
    lastIntentId: value.lastIntentId,
  };
  try {
    if (new TextEncoder().encode(JSON.stringify(record)).byteLength > MAX_PERSONALIZATION_CLOUD_RECORD_BYTES) return null;
  } catch {
    return null;
  }
  return record;
}

async function callWorker(
  userId: string,
  init: RequestInit,
): Promise<PersonalizationWorkerResult> {
  const { url, secret } = requireWorkerConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${url}/personalization/${encodeURIComponent(userId)}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "X-Personalization-Sync-Secret": secret,
        ...(init.headers || {}),
      },
    });
    let body: unknown = null;
    try { body = await response.json(); } catch { /* handled below */ }
    if (!response.ok) {
      const isWorkerAuthFailure = response.status === 401 || response.status === 403;
      throw new PersonalizationSyncError(
        isWorkerAuthFailure
          ? "Personalization sync is unavailable."
          : isRecord(body) && typeof body.error === "string"
            ? body.error
            : "Personalization sync failed.",
        isWorkerAuthFailure ? 503 : response.status,
        isWorkerAuthFailure || response.status === 429 || response.status >= 500,
        response.headers.get("retry-after") || undefined,
      );
    }
    if (!isRecord(body) || (body.status !== "ok" && body.status !== "empty")) {
      throw new PersonalizationSyncError("Personalization sync returned an invalid response.", 502);
    }
    if (body.status === "empty") return { status: "empty", record: null };
    const record = validateRecord(body.record);
    if (!record) throw new PersonalizationSyncError("Personalization sync returned an invalid record.", 502);
    return { status: "ok", record };
  } catch (error) {
    if (error instanceof PersonalizationSyncError) throw error;
    throw new PersonalizationSyncError("Personalization sync is unavailable.", 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

export function getPersonalizationFromCloud(userId: string): Promise<PersonalizationWorkerResult> {
  return callWorker(userId, { method: "GET" });
}

export function putPersonalizationToCloud(
  userId: string,
  payload: { config: PersonalizationConfigV1; intentId: string; knownRevision: string | null },
): Promise<PersonalizationWorkerResult> {
  return callWorker(userId, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}