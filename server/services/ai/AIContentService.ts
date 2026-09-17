import type { AIProvider, SafeProviderMetadata } from "./contracts.js";
import type { AIContentPart } from "./input/contracts.js";
import { aiContentPartSchema } from "./input/schemas.js";
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
  /** Untrusted, normalized source parts. These never become system instructions. */
  contents: AIContentPart[];
  /** Optional trusted instruction authored by application code, not by an upload. */
  trustedSystemInstruction?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export interface AIStructuredContentRequest<T> {
  contents: AIContentPart[];
  responseSchema: import("zod").ZodType<T>;
  trustedSystemInstruction?: string;
  additionalUntrustedContext?: string;
  operation?: import("./contracts.js").AIOperation;
  requestedCount?: number;
  maxItems?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function validateContentParts(contents: AIContentPart[]): AIContentPart[] {
  if (!Array.isArray(contents) || contents.length === 0) {
    throw new AIServiceError("AI_VALIDATION_ERROR", {
      publicMessage: "AI source content cannot be empty.",
      diagnosticMessage: "AIContentService received no content parts.",
    });
  }
  return contents.map((part) => aiContentPartSchema.parse(part) as AIContentPart);
}

export class AIContentService {
  constructor(private readonly provider: AIProvider) {}

  async generateStructured<T>(
    request: AIStructuredContentRequest<T>,
  ): Promise<{ data: T; meta: SafeProviderMetadata }> {
    try {
      const validatedContents = validateContentParts(request.contents);
      return await this.provider.generateStructured({
        ...request,
        contents: validatedContents,
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

  async processContent(request: AIContentExecutionRequest): Promise<AIResponseEnvelope> {
    const {
      contents,
      trustedSystemInstruction,
      timeoutMs,
      signal,
      ...envelope
    } = request;
    const startedAt = performance.now();

    try {
      const validatedEnvelope = aiRequestEnvelopeSchema.parse(envelope);
      const validatedContents = validateContentParts(contents);
      const contentMatchesMode =
        (validatedEnvelope.inputKind === "text" &&
          validatedContents.length === 1 &&
          validatedContents[0]?.kind === "text") ||
        (validatedEnvelope.inputKind === "pdf" &&
          validatedContents.length === 1 &&
          validatedContents[0]?.kind === "file" &&
          validatedContents[0].inputType === "pdf") ||
        (validatedEnvelope.inputKind === "image" &&
          validatedContents.every(
            (part) => part.kind === "file" && part.inputType === "image",
          ));
      if (!contentMatchesMode) {
        throw new AIServiceError("AI_INPUT_INVALID", {
          publicMessage: "AI source content does not match the selected input mode.",
          diagnosticMessage: "Content-part kinds contradicted the request inputKind.",
        });
      }
      let items: unknown[];
      let warnings: string[];
      let provider: SafeProviderMetadata;
      if (validatedEnvelope.target === "mcq") {
        const result = await this.provider.generateStructured({
          contents: validatedContents,
          responseSchema: aiMcqCandidateBatchSchema,
          trustedSystemInstruction,
          timeoutMs,
          signal,
        });
        ({ items, warnings } = result.data);
        provider = result.meta;
      } else {
        const result = await this.provider.generateStructured({
          contents: validatedContents,
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