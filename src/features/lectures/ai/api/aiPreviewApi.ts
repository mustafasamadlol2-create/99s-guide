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
/** Compatibility export for older callers; the job client does not use an overall deadline. */
export const AI_PREVIEW_TIMEOUT_MS = Number.POSITIVE_INFINITY;

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
  while (true) {
    try {
      const status = await dependencies.readStatus();
      onProgress?.(status);
      if (status.state === "succeeded" && status.response) return status.response;
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
    const accepted = await acceptedResponse.json() as AIPreviewJobAccepted;
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
        return statusResponse.json() as Promise<AIPreviewJobStatus>;
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