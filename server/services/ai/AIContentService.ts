import type { AIProvider, SafeProviderMetadata } from "./contracts.js";
import { AIServiceError, isAIServiceError } from "./errors.js";
import {
  aiFlashcardCandidateBatchSchema,
  aiMcqCandidateBatchSchema,
  aiRequestEnvelopeSchema,
  aiResponseEnvelopeSchema,
  type AIRequestEnvelope,
  type AIResponseEnvelope,
} from "./schemas.js";

export type AIContentExecutionRequest = AIRequestEnvelope & {
  /** Untrusted source data. This must never be promoted to a system instruction. */
  sourceContent: string;
  /** Optional trusted instruction authored by application code, not by an upload. */
  trustedSystemInstruction?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export class AIContentService {
  constructor(private readonly provider: AIProvider) {}

  async processContent(request: AIContentExecutionRequest): Promise<AIResponseEnvelope> {
    const {
      sourceContent,
      trustedSystemInstruction,
      timeoutMs,
      signal,
      ...envelope
    } = request;
    if (!sourceContent.trim()) {
      throw new AIServiceError("AI_VALIDATION_ERROR", {
        publicMessage: "AI source content cannot be empty.",
        diagnosticMessage: "AIContentService received empty contents.",
      });
    }
    const startedAt = performance.now();

    try {
      const validatedEnvelope = aiRequestEnvelopeSchema.parse(envelope);
      let items: unknown[];
      let warnings: string[];
      let provider: SafeProviderMetadata;
      if (validatedEnvelope.target === "mcq") {
        const result = await this.provider.generateStructured({
          sourceContent,
          responseSchema: aiMcqCandidateBatchSchema,
          trustedSystemInstruction,
          timeoutMs,
          signal,
        });
        ({ items, warnings } = result.data);
        provider = result.meta;
      } else {
        const result = await this.provider.generateStructured({
          sourceContent,
          responseSchema: aiFlashcardCandidateBatchSchema,
          trustedSystemInstruction,
          timeoutMs,
          signal,
        });
        ({ items, warnings } = result.data);
        provider = result.meta;
      }
      const expectedProvenance = {
        extract: "extracted",
        generate: "generated",
        enhance: "enhanced",
      }[validatedEnvelope.operation];
      if (items.some((item) =>
        typeof item !== "object" ||
        item === null ||
        !("provenance" in item) ||
        item.provenance !== expectedProvenance
      )) {
        throw new AIServiceError("AI_INVALID_RESPONSE", {
          publicMessage: "The AI response contained inconsistent provenance.",
          diagnosticMessage: "Candidate provenance did not match the requested operation.",
        });
      }
      return aiResponseEnvelopeSchema.parse({
        target: validatedEnvelope.target,
        operation: validatedEnvelope.operation,
        items,
        warnings,
        provider,
        processing: {
          durationMs: Math.max(0, performance.now() - startedAt),
        },
      });
    } catch (error) {
      if (isAIServiceError(error)) throw error;
      throw new AIServiceError("AI_VALIDATION_ERROR", {
        publicMessage: "The AI request or response did not match the required structure.",
        diagnosticMessage: error instanceof Error ? error.message : "Unknown validation failure.",
        cause: error,
      });
    }
  }
}