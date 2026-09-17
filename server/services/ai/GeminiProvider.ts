import { GoogleGenAI } from "@google/genai";
import { toJSONSchema, ZodError } from "zod";
import type {
  AIProvider,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from "./contracts.js";
import { getGeminiConfig, type GeminiConfig } from "./config.js";
import { AIServiceError, isAIServiceError } from "./errors.js";

interface GeminiGenerateContentParameters {
  model: string;
  contents: string;
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
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
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
  if (status === 503 || status === 502 || status === 504) {
    return new AIServiceError("AI_UNAVAILABLE", {
      publicMessage: "The AI service is temporarily unavailable.",
      diagnosticMessage: `Gemini returned HTTP ${status}.`,
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

  constructor(
    config: GeminiConfig = getGeminiConfig(),
    client?: GeminiClient,
  ) {
    this.config = config;
    this.client = client ?? new GoogleGenAI({ apiKey: config.apiKey });
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

    try {
      const response = await this.client.models.generateContent({
        model: this.config.model,
        contents: request.sourceContent,
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
        return {
          data: request.responseSchema.parse(parsed),
          meta: {
            provider: "gemini",
            model: response.modelVersion || this.config.model,
            responseId: response.responseId,
          },
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
      if (isAIServiceError(error)) throw error;
      throw providerError(error, bounded.signal.aborted && !request.signal?.aborted);
    } finally {
      bounded.cleanup();
    }
  }
}