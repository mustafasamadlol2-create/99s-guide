import type {
  AIProvider,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from "./contracts.js";
import { isAIServiceError } from "./errors.js";

const FALLBACK_CODES = new Set([
  "AI_TIMEOUT",
  "AI_RATE_LIMITED",
  "AI_UNAVAILABLE",
  "AI_PROVIDER_ERROR",
  "AI_INVALID_RESPONSE",
  "AI_VALIDATION_ERROR",
  "AI_MEDIA_UPLOAD_FAILED",
  "AI_MEDIA_PROCESSING_FAILED",
  "AI_MEDIA_PROCESSING_TIMEOUT",
  "AI_MEDIA_RESOLUTION_FAILED",
]);

function shouldFallback(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  return isAIServiceError(error) && FALLBACK_CODES.has(error.code);
}

/**
 * Job-scoped provider failover. The fallback is used only for provider/media
 * failures; invalid application input is never silently rerouted.
 */
export class FallbackAIProvider implements AIProvider {
  constructor(
    private readonly primary: AIProvider,
    private readonly fallback: AIProvider,
  ) {}

  async generateStructured<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResult<T>> {
    try {
      return await this.primary.generateStructured(request);
    } catch (error) {
      if (!shouldFallback(error, request.signal)) throw error;
      return this.fallback.generateStructured(request);
    }
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([
      this.primary.dispose?.(),
      this.fallback.dispose?.(),
    ].filter((value): value is Promise<void> => Boolean(value)));
  }
}
