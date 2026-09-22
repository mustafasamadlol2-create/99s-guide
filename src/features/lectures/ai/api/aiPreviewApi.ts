import { apiClient } from "../../../../core/api/apiClient";
import type {
  AIMCQCandidate,
  AIFlashcardCandidate,
  AIHttpErrorPayload,
  AIPreviewRequest,
  AIPreviewResponse,
} from "../types/aiPreview";

export const AI_PREVIEW_POLL_TIMEOUT_MS = 20_000;
export const AI_PREVIEW_POLL_INTERVAL_MS = 1_000;
export const AI_PREVIEW_MAX_CONSECUTIVE_POLL_FAILURES = 8;
export const AI_PREVIEW_TIMEOUT_MS = 20 * 60_000;

export class AIPreviewError extends Error {
  readonly code?: string;
  readonly requestId?: string;
  readonly retryable: boolean;
  readonly status?: number;
  readonly retryAfter?: string | null;

  constructor(message: string, details: {
    code?: string;
    requestId?: string;
    retryable?: boolean;
    status?: number;
    retryAfter?: string | null;
  } = {}) {
    super(message);
    this.name = "AIPreviewError";
    this.code = details.code;
    this.requestId = details.requestId;
    this.retryable = details.retryable ?? false;
    this.status = details.status;
    this.retryAfter = details.retryAfter;
  }
}

function appendScalar(form: FormData, request: AIPreviewRequest): void {
  form.append("lectureId", request.lectureId);
  form.append("operation", request.operation);
  form.append("inputKind", request.source.inputKind);
  form.append("options", JSON.stringify(request.options));
}

function errorFromUnknown(error: unknown): AIPreviewError {
  if (error instanceof AIPreviewError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new AIPreviewError("AI preview cancelled.", { code: "ABORTED" });
  }

  const candidate = error as Error & {
    status?: number;
    body?: AIHttpErrorPayload;
  };
  const payload = candidate.body;
  if (payload?.error) {
    return new AIPreviewError(
      payload.error.message || "AI preview could not be completed.",
      {
        code: payload.error.code,
        requestId: payload.requestId,
        retryable: payload.error.retryable,
        status: candidate.status,
      },
    );
  }
  return new AIPreviewError(candidate.message || "AI preview could not be completed.", {
    status: candidate.status,
  });
}

interface AIPreviewJobAccepted {
  requestId: string;
  jobId: string;
  state: "queued" | "running";
  target: AIPreviewRequest["target"];
  operation: AIPreviewRequest["operation"];
  inputKind: AIPreviewRequest["source"]["inputKind"];
}

export interface AIPreviewJobStatus {
  jobId: string;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  target: AIPreviewRequest["target"];
  operation: AIPreviewRequest["operation"];
  inputKind: AIPreviewRequest["source"]["inputKind"];
  progress: {
    stage: string;
    completedBatches: number;
    totalBatches?: number;
    itemsRecovered: number;
  };
  response?: AIPreviewResponse<AIMCQCandidate | AIFlashcardCandidate>;
  error?: { code?: string; message?: string; retryable?: boolean };
}

const JOB_STATES = new Set(["queued", "running", "succeeded", "failed", "cancelled"]);
const ACCEPTED_JOB_STATES = new Set(["queued", "running"]);

function parseAcceptedJob(value: unknown): AIPreviewJobAccepted {
  if (!value || typeof value !== "object") {
    throw new AIPreviewError("The AI server returned an invalid job response.", { code: "AI_INVALID_JOB_RESPONSE", retryable: true });
  }
  const record = value as Partial<AIPreviewJobAccepted>;
  if (typeof record.jobId !== "string" || !record.jobId.trim() || !ACCEPTED_JOB_STATES.has(String(record.state))) {
    throw new AIPreviewError("The AI server did not return a valid preview job ID.", { code: "AI_INVALID_JOB_RESPONSE", retryable: true });
  }
  return record as AIPreviewJobAccepted;
}

function parseJobStatus(value: unknown): AIPreviewJobStatus {
  if (!value || typeof value !== "object") {
    throw new AIPreviewError("The AI server returned an invalid status response.", { code: "AI_INVALID_JOB_STATUS", retryable: true });
  }
  const record = value as Partial<AIPreviewJobStatus>;
  if (typeof record.jobId !== "string" || !record.jobId.trim() || !JOB_STATES.has(String(record.state))) {
    throw new AIPreviewError("The AI preview status was malformed instead of remaining on an endless loading screen.", { code: "AI_INVALID_JOB_STATUS", retryable: true });
  }
  if (!record.progress || typeof record.progress.stage !== "string") {
    throw new AIPreviewError("The AI preview progress response was incomplete.", { code: "AI_INVALID_JOB_STATUS", retryable: true });
  }
  return record as AIPreviewJobStatus;
}

function requestBody(request: AIPreviewRequest): { body: BodyInit; headers: HeadersInit } {
  if (request.source.inputKind === "text") {
    return {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lectureId: request.lectureId,
        operation: request.operation,
        inputKind: "text",
        text: request.source.text ?? "",
        options: request.options,
      }),
    };
  }
  const form = new FormData();
  appendScalar(form, request);
  if (request.source.inputKind === "pdf" && request.source.file) {
    form.append("file", request.source.file);
  } else {
    for (const file of request.source.files ?? []) form.append("files", file);
  }
  return { body: form, headers: {} };
}

export function isRetryablePollFailure(error: unknown): boolean {
  if (error instanceof AIPreviewError) return false;
  const candidate = error as { status?: number; message?: string };
  return candidate.status === undefined ||
    candidate.status === 408 ||
    candidate.status === 429 ||
    candidate.status >= 500 ||
    /network|fetch|timed out|too long|connect/i.test(candidate.message ?? "");
}

function waitForPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("The request was aborted.", "AbortError"));
      return;
    }
    const timer = window.setTimeout(resolve, AI_PREVIEW_POLL_INTERVAL_MS);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("The request was aborted.", "AbortError"));
    }, { once: true });
  });
}

export interface AIPreviewPollingDependencies {
  readStatus(): Promise<AIPreviewJobStatus>;
  wait(signal: AbortSignal): Promise<void>;
}

export async function pollAIPreviewJob(
  signal: AbortSignal,
  dependencies: AIPreviewPollingDependencies,
  onProgress?: (status: AIPreviewJobStatus) => void,
): Promise<AIPreviewResponse<AIMCQCandidate | AIFlashcardCandidate>> {
  let consecutivePollFailures = 0;
  const startedAt = Date.now();
  while (true) {
    if (Date.now() - startedAt >= AI_PREVIEW_TIMEOUT_MS) {
      throw new AIPreviewError(
        "AI analysis took too long to complete. The job was stopped so it cannot remain stuck indefinitely.",
        { code: "AI_PREVIEW_TIMEOUT", retryable: true },
      );
    }
    try {
      const status = await dependencies.readStatus();
      consecutivePollFailures = 0;
      onProgress?.(status);
      if (status.state === "succeeded") {
        if (status.response) return status.response;
        throw new AIPreviewError("The AI job completed without a result payload.", { code: "AI_RESULT_MISSING", retryable: true });
      }
      if (status.state === "cancelled") {
        throw new AIPreviewError("AI preview cancelled.", { code: "AI_JOB_CANCELLED" });
      }
      if (status.state === "failed") {
        throw new AIPreviewError(
          status.error?.message || "AI preview could not be completed.",
          {
            code: status.error?.code,
            retryable: status.error?.retryable,
          },
        );
      }
    } catch (error) {
      if (!isRetryablePollFailure(error)) throw error;
      consecutivePollFailures += 1;
      if (consecutivePollFailures >= AI_PREVIEW_MAX_CONSECUTIVE_POLL_FAILURES) {
        throw new AIPreviewError(
          "AI preview status could not be reached after repeated retries. Please retry the preview.",
          { code: "AI_STATUS_UNAVAILABLE", retryable: true },
        );
      }
      await dependencies.wait(signal);
      continue;
    }
    await dependencies.wait(signal);
  }
}

export async function requestAIPreview(
  request: AIPreviewRequest,
  signal: AbortSignal,
  onProgress?: (status: AIPreviewJobStatus) => void,
  onJobCreated?: (jobId: string) => void,
): Promise<AIPreviewResponse<AIMCQCandidate | AIFlashcardCandidate>> {
  try {
    const endpoint = request.target === "mcq"
      ? "/api/admin/ai/mcq/preview-jobs"
      : "/api/admin/ai/flashcards/preview-jobs";
    const requestPayload = requestBody(request);
    const acceptedResponse = await apiClient(endpoint, {
      method: "POST",
      headers: requestPayload.headers,
      body: requestPayload.body,
      signal,
      bypassCache: true,
      retries: 0,
      timeoutMs: 120_000,
    });
    const accepted = parseAcceptedJob(await acceptedResponse.json());
    onJobCreated?.(accepted.jobId);
    return await pollAIPreviewJob(signal, {
      readStatus: async () => {
        const statusResponse = await apiClient(
          `${endpoint}/${encodeURIComponent(accepted.jobId)}`,
          {
            method: "GET",
            signal,
            bypassCache: true,
            retries: 0,
            timeoutMs: AI_PREVIEW_POLL_TIMEOUT_MS,
          },
        );
        return parseJobStatus(await statusResponse.json());
      },
      wait: waitForPoll,
    }, onProgress);
  } catch (error) {
    throw errorFromUnknown(error);
  }
}

export async function cancelAIPreviewJob(
  request: Pick<AIPreviewRequest, "target">,
  jobId: string,
): Promise<void> {
  const endpoint = request.target === "mcq"
    ? "/api/admin/ai/mcq/preview-jobs"
    : "/api/admin/ai/flashcards/preview-jobs";
  await apiClient(`${endpoint}/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
    bypassCache: true,
    retries: 0,
    timeoutMs: AI_PREVIEW_POLL_TIMEOUT_MS,
  });
}