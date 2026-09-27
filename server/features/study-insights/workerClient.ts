import {
  studyInsightCacheEntrySchema,
  type StudyInsightCacheEntry,
  type StudyInsightLocale,
} from "../../../shared/studyInsights.js";
import type {
  StudyInsightWorkerRequest,
  StudyInsightWorkerResponse,
} from "./types.js";

const MAX_WORKER_RESPONSE_BYTES = 32 * 1024;
const WORKER_TIMEOUT_MS = 30_000;

export class StudyInsightWorkerError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "StudyInsightWorkerError";
  }
}

export type StudyInsightWorkerCall = (input: {
  request: StudyInsightWorkerRequest;
  cacheKey: string;
  cacheEnabled: boolean;
  expectedModel: string;
}) => Promise<StudyInsightWorkerResponse>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createStudyInsightWorkerCall(options: {
  environment?: Readonly<Record<string, string | undefined>>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): StudyInsightWorkerCall {
  const environment = options.environment ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? WORKER_TIMEOUT_MS;

  return async ({ request, cacheKey, cacheEnabled, expectedModel }) => {
    const baseUrl = environment.PERSONALIZATION_WORKER_URL?.trim().replace(/\/+$/u, "");
    const secret = environment.PERSONALIZATION_SYNC_SECRET?.trim();
    if (!baseUrl || !secret) throw new StudyInsightWorkerError("WORKER_NOT_CONFIGURED");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/internal/ai/study-insights`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Personalization-Sync-Secret": secret,
            "X-Study-Insight-Cache-Key": cacheKey,
            "X-Study-Insight-Cache-Enabled": cacheEnabled ? "true" : "false",
            "X-Study-Insight-Model": expectedModel,
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
      } catch {
        throw new StudyInsightWorkerError(controller.signal.aborted ? "WORKER_TIMEOUT" : "WORKER_UNAVAILABLE");
      }

      const responseText = await response.text();
      if (new TextEncoder().encode(responseText).byteLength > MAX_WORKER_RESPONSE_BYTES) {
        throw new StudyInsightWorkerError("WORKER_RESPONSE_TOO_LARGE");
      }
      let payload: unknown;
      try {
        payload = JSON.parse(responseText);
      } catch {
        throw new StudyInsightWorkerError("WORKER_RESPONSE_INVALID");
      }
      if (!response.ok || !isRecord(payload) || payload.status !== "ok") {
        const code = isRecord(payload) && typeof payload.code === "string"
          ? payload.code
          : "WORKER_REQUEST_FAILED";
        throw new StudyInsightWorkerError(code);
      }
      const parsedEntry = studyInsightCacheEntrySchema.safeParse(payload.entry);
      if (!parsedEntry.success ||
          typeof payload.cacheHit !== "boolean" ||
          parsedEntry.data.model !== expectedModel) {
        throw new StudyInsightWorkerError("WORKER_RESPONSE_INVALID");
      }
      return {
        status: "ok",
        cacheHit: payload.cacheHit,
        entry: parsedEntry.data as StudyInsightCacheEntry,
      };
    } finally {
      clearTimeout(timeout);
    }
  };
}

export function isStudyInsightLocale(value: unknown): value is StudyInsightLocale {
  return value === "ar" || value === "en";
}