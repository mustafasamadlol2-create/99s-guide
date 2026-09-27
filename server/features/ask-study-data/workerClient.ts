import {
  ASK_STUDY_DATA_MAX_FACT_SET_BYTES,
  ASK_STUDY_DATA_MAX_QUESTION_CHARACTERS,
  askStudyDataAnswerSchema,
  askStudyDataFactSetSchema,
  type AskStudyDataLocale,
} from "../../../shared/askStudyData.js";
import type { AskStudyDataWorkerRequest } from "./types.js";

const MAX_WORKER_RESPONSE_BYTES = 16 * 1024;
const WORKER_TIMEOUT_MS = 30_000;

export class AskStudyDataWorkerError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AskStudyDataWorkerError";
  }
}

export type AskStudyDataWorkerCall = (request: AskStudyDataWorkerRequest) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAskStudyDataLocale(value: unknown): value is AskStudyDataLocale {
  return value === "ar" || value === "en";
}

export function createAskStudyDataWorkerCall(options: {
  environment?: Readonly<Record<string, string | undefined>>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): AskStudyDataWorkerCall {
  const environment = options.environment ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? WORKER_TIMEOUT_MS;
  return async (request) => {
    const parsedFacts = askStudyDataFactSetSchema.safeParse(request.facts);
    if (!parsedFacts.success ||
        new TextEncoder().encode(JSON.stringify(request.facts)).byteLength > ASK_STUDY_DATA_MAX_FACT_SET_BYTES ||
        Array.from(request.question.trim()).length > ASK_STUDY_DATA_MAX_QUESTION_CHARACTERS) {
      throw new AskStudyDataWorkerError("INVALID_INTERNAL_REQUEST");
    }
    const baseUrl = environment.PERSONALIZATION_WORKER_URL?.trim().replace(/\/+$/u, "");
    const secret = environment.PERSONALIZATION_SYNC_SECRET?.trim();
    if (!baseUrl || !secret) throw new AskStudyDataWorkerError("WORKER_NOT_CONFIGURED");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/internal/ai/ask-study-data`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Personalization-Sync-Secret": secret,
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
      } catch {
        throw new AskStudyDataWorkerError(controller.signal.aborted ? "WORKER_TIMEOUT" : "WORKER_UNAVAILABLE");
      }
      const responseText = await response.text();
      if (new TextEncoder().encode(responseText).byteLength > MAX_WORKER_RESPONSE_BYTES) {
        throw new AskStudyDataWorkerError("WORKER_RESPONSE_TOO_LARGE");
      }
      let payload: unknown;
      try {
        payload = JSON.parse(responseText);
      } catch {
        throw new AskStudyDataWorkerError("WORKER_RESPONSE_INVALID");
      }
      if (!response.ok || !isRecord(payload) || payload.status !== "ok") {
        throw new AskStudyDataWorkerError(
          isRecord(payload) && typeof payload.code === "string" ? payload.code : "WORKER_REQUEST_FAILED",
        );
      }
      if (!askStudyDataAnswerSchema.safeParse(payload.answer).success) {
        throw new AskStudyDataWorkerError("WORKER_RESPONSE_INVALID");
      }
      return payload.answer;
    } finally {
      clearTimeout(timeout);
    }
  };
}