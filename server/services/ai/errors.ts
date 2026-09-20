export const AI_ERROR_CODES = [
  "AI_CONFIG_ERROR",
  "AI_PROVIDER_ERROR",
  "AI_TIMEOUT",
  "AI_RATE_LIMITED",
  "AI_INVALID_RESPONSE",
  "AI_VALIDATION_ERROR",
  "AI_UNAVAILABLE",
  "AI_INPUT_INVALID",
  "AI_INPUT_TOO_LARGE",
  "AI_INPUT_UNSUPPORTED",
  "AI_INPUT_STAGE_FAILED",
  "AI_INPUT_CLEANUP_FAILED",
  "AI_MEDIA_UPLOAD_FAILED",
  "AI_MEDIA_PROCESSING_FAILED",
  "AI_MEDIA_PROCESSING_TIMEOUT",
  "AI_MEDIA_CLEANUP_FAILED",
  "AI_MEDIA_RESOLUTION_FAILED",
  "AI_EXTRACTION_INCOMPLETE",
] as const;

export type AIErrorCode = (typeof AI_ERROR_CODES)[number];

interface AIErrorOptions {
  publicMessage: string;
  diagnosticMessage?: string;
  retryable?: boolean;
  cause?: unknown;
}

export class AIServiceError extends Error {
  readonly code: AIErrorCode;
  readonly publicMessage: string;
  readonly diagnosticMessage?: string;
  readonly retryable: boolean;

  constructor(code: AIErrorCode, options: AIErrorOptions) {
    super(options.publicMessage, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AIServiceError";
    this.code = code;
    this.publicMessage = options.publicMessage;
    this.diagnosticMessage = options.diagnosticMessage;
    this.retryable = options.retryable ?? false;
  }
}

export function isAIServiceError(error: unknown): error is AIServiceError {
  return error instanceof AIServiceError;
}