import { randomUUID } from "node:crypto";
import type { PreparedAIInput } from "../input/contracts.js";
import { AIContentService } from "../AIContentService.js";
import { AIServiceError } from "../errors.js";
import type {
  AIFlashcardCandidate,
  FlashcardEnhancementOptions,
  FlashcardGenerationOptions,
  FlashcardOperationResult,
  SkippedFlashcardSourceItem,
} from "./contracts.js";
import {
  DEFAULT_FLASHCARD_ENGINE_CONFIG,
  FLASHCARD_PROMPT_VERSION,
  type FlashcardEngineConfig,
} from "./config.js";
import {
  flashcardEnhancementProviderResponseSchema,
  flashcardExtractionProviderResponseSchema,
  flashcardGenerationProviderResponseSchema,
  type FlashcardEnhancementProviderResponse,
} from "./schemas.js";
import {
  buildFlashcardEnhanceInstruction,
  buildFlashcardExtractInstruction,
  buildFlashcardGenerateInstruction,
} from "./promptBuilder.js";
import { applyFlashcardBatchDuplicateWarnings, applyFlashcardQualityWarnings, summarizeFlashcardCounts } from "./quality.js";
import { normalizeExtractedFlashcards, normalizeGeneratedFlashcards } from "./normalize.js";
import { validateFlashcardSourceEvidence } from "./sourceValidation.js";

function requiredGenerationOptions(
  options: FlashcardGenerationOptions | undefined,
  config: FlashcardEngineConfig,
): Required<FlashcardGenerationOptions> {
  const count = options?.count ?? config.generationDefaultCount;
  if (!Number.isInteger(count) || count < 1 || count > config.generationMaxCount) {
    throw new AIServiceError("AI_VALIDATION_ERROR", {
      publicMessage: `Flashcard generation count must be between 1 and ${config.generationMaxCount}.`,
      diagnosticMessage: "Flashcard generation count was outside the configured range.",
    });
  }
  const focus = options?.focus?.trim() || null;
  if (focus && focus.length > config.maxFocusLength) {
    throw new AIServiceError("AI_VALIDATION_ERROR", {
      publicMessage: `Flashcard focus must be ${config.maxFocusLength} characters or fewer.`,
      diagnosticMessage: "Flashcard generation focus exceeded the configured limit.",
    });
  }
  return { count, focus };
}

function requiredEnhancementOptions(
  options: FlashcardEnhancementOptions | undefined,
): Required<FlashcardEnhancementOptions> {
  if (options?.explanation !== undefined && options.explanation !== true) {
    throw new AIServiceError("AI_VALIDATION_ERROR", {
      publicMessage: "Flashcard enhancement only supports filling a missing explanation.",
      diagnosticMessage: "Flashcard enhancement received an unsupported option.",
    });
  }
  return { explanation: true };
}

function baseResult(
  operation: FlashcardOperationResult["operation"],
  items: AIFlashcardCandidate[],
  skippedItems: SkippedFlashcardSourceItem[],
  warnings: string[],
  provider: FlashcardOperationResult["provider"],
  startedAt: number,
  requestedCount?: number,
  truncated = false,
): FlashcardOperationResult {
  return {
    operation,
    promptVersion: FLASHCARD_PROMPT_VERSION,
    items,
    skippedItems,
    truncated,
    warnings: [...new Set(warnings)],
    requiresHumanApproval: true,
    counts: {
      ...(requestedCount === undefined ? {} : { requestedCount }),
      ...summarizeFlashcardCounts(items, skippedItems.length),
    },
    provider,
    processing: { durationMs: Math.max(0, performance.now() - startedAt) },
  };
}

function enhancementContext(items: AIFlashcardCandidate[]): string {
  return JSON.stringify({
    purpose: "untrusted extracted Flashcard candidates for explanation enhancement",
    candidates: items.map((item) => ({
      candidateId: item.candidateId,
      clinicalConcept: item.clinicalConcept,
      explanation: item.explanation,
      source: item.source,
    })),
  });
}

export class FlashcardAIEngine {
  constructor(
    private readonly contentService: AIContentService,
    private readonly config: FlashcardEngineConfig = DEFAULT_FLASHCARD_ENGINE_CONFIG,
    private readonly candidateId: () => string = randomUUID,
  ) {}

  async extractExistingFlashcards(input: PreparedAIInput): Promise<FlashcardOperationResult> {
    const startedAt = performance.now();
    const response = await this.contentService.generateStructured({
      contents: input.contents,
      responseSchema: flashcardExtractionProviderResponseSchema,
      trustedSystemInstruction: buildFlashcardExtractInstruction(),
    });
    const normalized = normalizeExtractedFlashcards(response.data, input, this.candidateId);
    let items = applyFlashcardBatchDuplicateWarnings(normalized.items);
    const skippedItems = normalized.skippedItems.slice(0, this.config.maxSkippedItems);
    const warnings = [
      ...normalized.warnings,
      ...response.data.uncertainties.map((value) => `Model uncertainty: ${value}`),
    ];
    if (normalized.skippedItems.length > this.config.maxSkippedItems) {
      warnings.push("Skipped source items exceeded the configured reporting limit.");
    }
    const truncated = response.data.truncated || response.data.items.length > this.config.extractionMaxCount;
    if (response.data.items.length > this.config.extractionMaxCount) {
      warnings.push("Extraction exceeded the configured maximum and was truncated.");
    }
    items = items.slice(0, this.config.extractionMaxCount);
    if (items.length < normalized.items.length) {
      warnings.push("Extraction candidates were truncated to the configured maximum.");
    }
    return baseResult("extract", items, skippedItems, warnings, response.meta, startedAt, undefined, truncated);
  }

  async generateFlashcards(
    input: PreparedAIInput,
    options?: FlashcardGenerationOptions,
  ): Promise<FlashcardOperationResult> {
    const selected = requiredGenerationOptions(options, this.config);
    const startedAt = performance.now();
    const response = await this.contentService.generateStructured({
      contents: input.contents,
      responseSchema: flashcardGenerationProviderResponseSchema,
      trustedSystemInstruction: buildFlashcardGenerateInstruction(selected),
    });
    const items = applyFlashcardBatchDuplicateWarnings(
      normalizeGeneratedFlashcards(response.data, input, this.candidateId),
    );
    const warnings = response.data.uncertainties.map((value) => `Model uncertainty: ${value}`);
    if (items.length < selected.count) {
      warnings.push(`Requested ${selected.count} Flashcards but only ${items.length} source-grounded Flashcards were generated.`);
    }
    return baseResult("generate", items, [], warnings, response.meta, startedAt, selected.count);
  }

  async enhanceExistingFlashcards(
    input: PreparedAIInput,
    options?: FlashcardEnhancementOptions,
  ): Promise<FlashcardOperationResult> {
    const startedAt = performance.now();
    requiredEnhancementOptions(options);
    const extraction = await this.extractExistingFlashcards(input);
    const candidates = extraction.items.map((item) => ({ ...item }));
    const eligible = candidates.filter((item) => item.clinicalConcept.trim() && item.explanation === null);
    const warnings = [...extraction.warnings];

    if (eligible.length === 0) {
      warnings.push("No extracted Flashcards were eligible for explanation enhancement.");
      return baseResult(
        "enhance",
        applyFlashcardBatchDuplicateWarnings(candidates.map((candidate) => applyFlashcardQualityWarnings(
          { ...candidate, provenance: "enhanced" as const },
          { requireExplanation: true, reviewConfidenceThreshold: this.config.reviewConfidenceThreshold },
        ))),
        extraction.skippedItems,
        warnings,
        extraction.provider,
        startedAt,
        undefined,
        extraction.truncated,
      );
    }

    const response = await this.contentService.generateStructured({
      contents: input.contents,
      responseSchema: flashcardEnhancementProviderResponseSchema,
      trustedSystemInstruction: buildFlashcardEnhanceInstruction(),
      additionalUntrustedContext: enhancementContext(eligible),
    });
    const eligibleIds = new Set(eligible.map((candidate) => candidate.candidateId));
    const hasUnknownCandidateId = response.data.items.some((item) => !eligibleIds.has(item.candidateId));
    if (hasUnknownCandidateId) {
      warnings.push("Enhancement response contained an unknown candidate ID.");
    }
    const merged = this.mergeEnhancements(candidates, eligible, response.data, input);
    return baseResult(
      "enhance",
      applyFlashcardBatchDuplicateWarnings(merged),
      extraction.skippedItems,
      warnings.concat(response.data.uncertainties.map((value) => `Model uncertainty: ${value}`)),
      response.meta,
      startedAt,
      undefined,
      extraction.truncated,
    );
  }

  private mergeEnhancements(
    candidates: AIFlashcardCandidate[],
    eligible: AIFlashcardCandidate[],
    response: FlashcardEnhancementProviderResponse,
    input: PreparedAIInput,
  ): AIFlashcardCandidate[] {
    const eligibleIds = new Set(eligible.map((candidate) => candidate.candidateId));
    const responseById = new Map(response.items.map((item) => [item.candidateId, item]));
    return candidates.map((candidate) => {
      const stage2 = responseById.get(candidate.candidateId);
      const candidateWarnings = [...candidate.warnings];
      let explanation = candidate.explanation;
      let source = candidate.source;
      let confidence = candidate.confidence;

      if (eligibleIds.has(candidate.candidateId)) {
        if (!stage2) {
          candidateWarnings.push("No explanation enhancement result was returned for this candidate.");
        } else {
          explanation = stage2.explanation;
          confidence = stage2.confidence;
          candidateWarnings.push(...stage2.uncertainties.map((value) => `Model uncertainty: ${value}`));
          if (stage2.source !== undefined) {
            const validatedSource = validateFlashcardSourceEvidence(stage2.source, input);
            source = validatedSource.source;
            candidateWarnings.push(...validatedSource.warnings);
          }
          if (stage2.confidence < this.config.reviewConfidenceThreshold) {
            candidateWarnings.push("Enhancement confidence is below the review threshold.");
          }
        }
      }

      return applyFlashcardQualityWarnings({
        ...candidate,
        explanation,
        source,
        confidence,
        provenance: "enhanced" as const,
        warnings: [...new Set(candidateWarnings)],
      }, {
        requireExplanation: true,
        reviewConfidenceThreshold: this.config.reviewConfidenceThreshold,
      });
    });
  }
}