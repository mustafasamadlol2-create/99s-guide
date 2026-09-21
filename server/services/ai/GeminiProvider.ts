import { GoogleGenAI } from "@google/genai";
import { toJSONSchema, ZodError } from "zod";
import type {
  AIProvider,
  SafeProviderMetadata,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from "./contracts.js";
import { getGeminiConfig, type GeminiConfig } from "./config.js";
import { AIServiceError, isAIServiceError } from "./errors.js";
import type { AITextPart } from "./input/contracts.js";
import { getGeminiMediaConfig, type GeminiMediaConfig } from "./gemini/config.js";
import { GeminiFilesManager, type GeminiFilesClient } from "./gemini/GeminiFilesManager.js";
import { GeminiMediaTransport } from "./gemini/GeminiMediaTransport.js";

interface GeminiGenerateContentParameters {
  model: string;
  contents: unknown;
  config?: {
    abortSignal?: AbortSignal;
    systemInstruction?: string;
    responseMimeType?: string;
    responseJsonSchema?: unknown;
  };
}

interface GeminiGenerateContentResponse {
  text?: string;
  modelVersion?: string;
  responseId?: string;
}

export interface GeminiClient {
  models: {
    generateContent(
      parameters: GeminiGenerateContentParameters,
    ): Promise<GeminiGenerateContentResponse>;
  };
  files?: GeminiFilesClient;
}

function toGeminiTextContents(
  requestContents: StructuredGenerationRequest<unknown>["contents"],
  additionalUntrustedContext?: string,
): unknown {
  const textParts = requestContents.filter(
    (part): part is AITextPart => part.kind === "text",
  );
  if (textParts.length === 0 || textParts.length !== requestContents.length) {
    throw new AIServiceError("AI_INPUT_UNSUPPORTED", {
      publicMessage: "Binary AI transport is not available yet.",
      diagnosticMessage: "Phase 3A does not convert staged files into Gemini media parts.",
    });
  }
  const parts = textParts.map((part) => ({ text: part.text }));
  if (additionalUntrustedContext) parts.push({ text: additionalUntrustedContext });
  return [{
    role: "user",
    parts,
  }];
}

function appendUntrustedContext(contents: unknown, context?: string): unknown {
  if (!context || !Array.isArray(contents) || contents.length === 0) return contents;
  const first = contents[0];
  if (typeof first !== "object" || first === null || !Array.isArray((first as { parts?: unknown }).parts)) {
    return contents;
  }
  return [{
    ...(first as Record<string, unknown>),
    parts: [
      ...((first as { parts: unknown[] }).parts),
      { text: context },
    ],
  }, ...contents.slice(1)];
}

const GEMINI_JSON_SCHEMA_KEYWORDS = new Set([
  "$id",
  "$defs",
  "$ref",
  "$anchor",
  "type",
  "format",
  "title",
  "description",
  "enum",
  "items",
  "prefixItems",
  "anyOf",
  "oneOf",
  "properties",
  "additionalProperties",
  "required",
  "propertyOrdering",
]);

function sanitizeSchemaMap(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, sanitizeGeminiJsonSchema(child)]),
  );
}

/**
 * Gemini accepts only a documented subset of JSON Schema. Structural output is
 * constrained with this subset; stricter Zod checks still run after parsing.
 */
export function sanitizeGeminiJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeGeminiJsonSchema);
  if (typeof value !== "object" || value === null) return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!GEMINI_JSON_SCHEMA_KEYWORDS.has(key)) continue;
    sanitized[key] = key === "properties" || key === "$defs"
      ? sanitizeSchemaMap(child)
      : sanitizeGeminiJsonSchema(child);
  }
  return sanitized;
}

function createBoundedSignal(
  timeoutMs: number,
  externalSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("AI request timed out.")), timeoutMs);
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    abortFromExternal();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    },
  };
}

function providerError(error: unknown, timedOut: boolean): AIServiceError {
  if (timedOut) {
    return new AIServiceError("AI_TIMEOUT", {
      publicMessage: "The AI request timed out.",
      diagnosticMessage: "Gemini request exceeded its configured timeout.",
      retryable: true,
      cause: error,
    });
  }

  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : undefined;
  if (status === 429) {
    return new AIServiceError("AI_RATE_LIMITED", {
      publicMessage: "The AI service is temporarily rate limited.",
      diagnosticMessage: "Gemini returned HTTP 429.",
      retryable: true,
      cause: error,
    });
  }
  if (status !== undefined && status >= 500) {
    return new AIServiceError("AI_UNAVAILABLE", {
      publicMessage: "The AI service is temporarily unavailable.",
      diagnosticMessage: `Gemini returned HTTP ${status}.`,
      retryable: true,
      cause: error,
    });
  }
  if (status === 400) {
    return new AIServiceError("AI_PROVIDER_ERROR", {
      publicMessage: "The AI provider could not complete the request.",
      diagnosticMessage: "provider_invalid_argument",
      cause: error,
    });
  }
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  if (
    error instanceof TypeError ||
    /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|ECONNREFUSED/iu.test(code) ||
    /network|socket|connection reset|fetch failed/iu.test(error instanceof Error ? error.message : "")
  ) {
    return new AIServiceError("AI_UNAVAILABLE", {
      publicMessage: "The AI service is temporarily unavailable.",
      diagnosticMessage: "Gemini request failed because of a transient network error.",
      retryable: true,
      cause: error,
    });
  }

  return new AIServiceError("AI_PROVIDER_ERROR", {
    publicMessage: "The AI provider could not complete the request.",
    diagnosticMessage: error instanceof Error ? error.message : "Unknown Gemini failure.",
    cause: error,
  });
}

export class GeminiProvider implements AIProvider {
  private readonly config: GeminiConfig;
  private readonly client: GeminiClient;
  private readonly mediaTransport?: GeminiMediaTransport;
  private readonly diagnosticSink?: (error: AIServiceError) => void | Promise<void>;
  private readonly reusableMedia = new Map<string, Promise<Awaited<ReturnType<GeminiMediaTransport["prepare"]>>>>();

  constructor(
    config: GeminiConfig = getGeminiConfig(),
    client?: GeminiClient,
    mediaConfig: GeminiMediaConfig = getGeminiMediaConfig(),
    diagnosticSink?: (error: AIServiceError) => void | Promise<void>,
  ) {
    this.config = config;
    this.client = client ?? new GoogleGenAI({ apiKey: config.apiKey });
    this.mediaTransport = new GeminiMediaTransport(
      this.client.files
        ? new GeminiFilesManager(this.client.files, {
          processingTimeoutMs: mediaConfig.fileProcessingTimeoutMs,
          pollIntervalMs: mediaConfig.filePollIntervalMs,
          cleanupTimeoutMs: mediaConfig.fileCleanupTimeoutMs,
        })
        : undefined,
      mediaConfig,
    );
    this.diagnosticSink = diagnosticSink;
  }

  private mediaKey(contents: StructuredGenerationRequest<unknown>["contents"]): string {
    return contents.map((part) =>
      part.kind === "text"
        ? `text:${part.sha256}`
        : `${part.inputType}:${part.mimeType}:${part.sha256}`,
    ).join("|");
  }

  private reusablePreparation(
    contents: StructuredGenerationRequest<unknown>["contents"],
    signal: AbortSignal,
  ): Promise<Awaited<ReturnType<GeminiMediaTransport["prepare"]>>> {
    const key = this.mediaKey(contents);
    const existing = this.reusableMedia.get(key);
    if (existing) return existing;
    const prepared = this.mediaTransport!.prepare(contents, signal).catch((error) => {
      this.reusableMedia.delete(key);
      throw error;
    });
    this.reusableMedia.set(key, prepared);
    return prepared;
  }

  async generateStructured<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResult<T>> {
    const timeoutMs = request.timeoutMs ?? this.config.timeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new AIServiceError("AI_VALIDATION_ERROR", {
        publicMessage: "The AI request timeout is invalid.",
        diagnosticMessage: "timeoutMs must be a positive finite number.",
      });
    }
    const bounded = createBoundedSignal(
      timeoutMs,
      request.signal,
    );

    let media: Awaited<ReturnType<GeminiMediaTransport["prepare"]>> | undefined;
    let resultMeta: SafeProviderMetadata | undefined;
    try {
      if (request.contents.some((part) => part.kind !== "text")) {
        media = request.reusePreparedMedia
          ? await this.reusablePreparation(request.contents, bounded.signal)
          : await this.mediaTransport.prepare(request.contents, bounded.signal);
      }
      const response = await this.client.models.generateContent({
        model: this.config.model,
        contents: media
          ? appendUntrustedContext(media.contents, request.additionalUntrustedContext)
          : toGeminiTextContents(request.contents, request.additionalUntrustedContext),
        config: {
          abortSignal: bounded.signal,
          systemInstruction: request.trustedSystemInstruction,
          responseMimeType: "application/json",
          responseJsonSchema: sanitizeGeminiJsonSchema(
            toJSONSchema(request.responseSchema, { target: "draft-07" }),
          ),
        },
      });

      if (!response.text) {
        throw new AIServiceError("AI_INVALID_RESPONSE", {
          publicMessage: "The AI provider returned an empty response.",
          diagnosticMessage: "Gemini response did not contain text.",
        });
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(response.text);
      } catch (error) {
        throw new AIServiceError("AI_INVALID_RESPONSE", {
          publicMessage: "The AI provider returned invalid structured data.",
          diagnosticMessage: "Gemini response was not valid JSON.",
          cause: error,
        });
      }

      try {
        const meta: SafeProviderMetadata = {
          provider: "gemini",
          model: response.modelVersion || this.config.model,
          responseId: response.responseId,
          ...(media ? { transport: media.transport, mediaCount: media.mediaCount } : {}),
        };
        resultMeta = meta;
        return {
          data: request.responseSchema.parse(parsed),
          meta,
        };
      } catch (error) {
        if (error instanceof ZodError) {
          throw new AIServiceError("AI_VALIDATION_ERROR", {
            publicMessage: "The AI response did not match the required structure.",
            diagnosticMessage: `Gemini response failed validation with ${error.issues.length} issue(s).`,
            cause: error,
          });
        }
        throw error;
      }
    } catch (error) {
      if (bounded.signal.aborted && !request.signal?.aborted) {
        throw new AIServiceError("AI_TIMEOUT", {
          publicMessage: "The AI request timed out.",
          diagnosticMessage: "The shared Gemini operation deadline expired.",
          retryable: true,
          cause: error,
        });
      }
      if (isAIServiceError(error)) throw error;
      throw providerError(error, bounded.signal.aborted && !request.signal?.aborted);
    } finally {
      if (media && !request.reusePreparedMedia) {
        try {
          await media.cleanup();
        } catch (error) {
          const cleanupError = error instanceof AIServiceError
            ? error
            : new AIServiceError("AI_MEDIA_CLEANUP_FAILED", {
              publicMessage: "AI media cleanup was incomplete.",
              diagnosticMessage: "Provider media cleanup failed.",
              cause: error,
            });
          if (this.diagnosticSink) {
            void Promise.resolve().then(() => this.diagnosticSink!(cleanupError)).catch(() => {});
          }
          if (resultMeta) resultMeta.cleanupWarning = "provider_media_cleanup_failed";
        }
      }
      bounded.cleanup();
    }
  }

  async dispose(): Promise<void> {
    const preparations = [...this.reusableMedia.values()];
    this.reusableMedia.clear();
    const settled = await Promise.allSettled(preparations);
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      try {
        await result.value.cleanup();
      } catch (error) {
        const cleanupError = error instanceof AIServiceError
          ? error
          : new AIServiceError("AI_MEDIA_CLEANUP_FAILED", {
            publicMessage: "AI media cleanup was incomplete.",
            diagnosticMessage: "Reusable provider media cleanup failed.",
            cause: error,
          });
        if (this.diagnosticSink) {
          await Promise.resolve(this.diagnosticSink(cleanupError)).catch(() => {});
        }
      }
    }
  }
}