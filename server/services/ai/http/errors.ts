import { MulterError } from "multer";
import { z } from "zod";
import { AIServiceError, isAIServiceError } from "../errors.js";

export interface AIHttpErrorDetails {
  field?: string;
  issues?: Array<{ field: string; message: string }>;
}

export class AIHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: AIHttpErrorDetails,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AIHttpError";
  }
}

function zodDetails(error: z.ZodError): AIHttpErrorDetails {
  return {
    issues: error.issues.slice(0, 20).map((issue) => ({
      field: issue.path.length > 0 ? issue.path.join(".") : "request",
      message: issue.message,
    })),
  };
}

export function mapAIError(error: unknown): AIHttpError {
  if (error instanceof AIHttpError) return error;
  if (error instanceof z.ZodError) {
    return new AIHttpError(400, "AI_INVALID_REQUEST", "The AI preview request is invalid.", false, zodDetails(error), error);
  }
  if (error instanceof MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    const code = status === 413 ? "AI_INPUT_TOO_LARGE" : "AI_MULTIPART_INVALID";
    const message = status === 413
      ? "An uploaded file exceeds the allowed size."
      : "The multipart AI preview request is invalid.";
    return new AIHttpError(status, code, message, false, { field: error.field }, error);
  }
  if (isAIServiceError(error)) {
    const mapped = (() => {
      switch (error.code) {
        case "AI_CONFIG_ERROR":
          return { status: 503, code: "AI_NOT_CONFIGURED", retryable: false };
        case "AI_INPUT_UNSUPPORTED":
          return { status: 415, code: error.code, retryable: false };
        case "AI_INPUT_TOO_LARGE":
          return { status: 413, code: error.code, retryable: false };
        case "AI_INVALID_RESPONSE":
        case "AI_VALIDATION_ERROR":
        case "AI_EXTRACTION_INCOMPLETE":
          return { status: 502, code: error.code, retryable: false };
        case "AI_RATE_LIMITED":
          return { status: 429, code: error.code, retryable: true };
        case "AI_TIMEOUT":
        case "AI_MEDIA_PROCESSING_TIMEOUT":
          return { status: 504, code: error.code, retryable: true };
        case "AI_UNAVAILABLE":
        case "AI_PROVIDER_ERROR":
        case "AI_MEDIA_UPLOAD_FAILED":
        case "AI_MEDIA_PROCESSING_FAILED":
        case "AI_MEDIA_RESOLUTION_FAILED":
          return { status: 503, code: error.code, retryable: error.retryable };
        default:
          return { status: 400, code: error.code, retryable: error.retryable };
      }
    })();
    return new AIHttpError(mapped.status, mapped.code, error.publicMessage, mapped.retryable, undefined, error);
  }
  return new AIHttpError(500, "AI_INTERNAL_ERROR", "The AI preview request could not be completed.", false, undefined, error);
}

export function sendAIError(
  res: { status(code: number): { json(body: unknown): unknown }; setHeader(name: string, value: string): void },
  requestId: string,
  error: unknown,
): void {
  const mapped = mapAIError(error);
  if (mapped.status === 429 && mapped.retryable) {
    const retryAfter = mapped.code === "APP_AI_RATE_LIMIT"
      ? Number(mapped.details?.field ?? 1)
      : undefined;
    if (retryAfter !== undefined && Number.isFinite(retryAfter)) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfter))));
    }
  }
  res.status(mapped.status).json({
    requestId,
    error: {
      code: mapped.code,
      message: mapped.message,
      retryable: mapped.retryable,
      ...(mapped.details?.issues ? { details: mapped.details.issues } : {}),
    },
  });
}