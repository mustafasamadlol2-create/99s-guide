import { apiClient } from "../../../../core/api/apiClient";
import type {
  AIMCQCandidate,
  AIFlashcardCandidate,
  AIHttpErrorPayload,
  AIPreviewRequest,
  AIPreviewResponse,
} from "../types/aiPreview";

const AI_PREVIEW_TIMEOUT_MS = 600_000;

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

export async function requestAIPreview(
  request: AIPreviewRequest,
  signal: AbortSignal,
): Promise<AIPreviewResponse<AIMCQCandidate | AIFlashcardCandidate>> {
  try {
    const endpoint = request.target === "mcq"
      ? "/api/admin/ai/mcq/preview"
      : "/api/admin/ai/flashcards/preview";
    let body: BodyInit;
    const headers: HeadersInit = {};

    if (request.source.inputKind === "text") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify({
        lectureId: request.lectureId,
        operation: request.operation,
        inputKind: "text",
        text: request.source.text ?? "",
        options: request.options,
      });
    } else {
      const form = new FormData();
      appendScalar(form, request);
      if (request.source.inputKind === "pdf" && request.source.file) {
        form.append("file", request.source.file);
      } else {
        for (const file of request.source.files ?? []) form.append("files", file);
      }
      body = form;
    }

    const response = await apiClient(endpoint, {
      method: "POST",
      headers,
      body,
      signal,
      bypassCache: true,
      retries: 0,
      timeoutMs: AI_PREVIEW_TIMEOUT_MS,
    });
    return await response.json() as AIPreviewResponse<AIMCQCandidate | AIFlashcardCandidate>;
  } catch (error) {
    throw errorFromUnknown(error);
  }
}