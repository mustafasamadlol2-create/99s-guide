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
import { runResilientBatches, shardTextContent } from "../reliability.js";
import { parseDeterministicFlashcards } from "./deterministicExtract.js";

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

  async extractExistingFlashcards(input: PreparedAIInput, signal?: AbortSignal): Promise<FlashcardOperationResult> {
    const startedAt = performance.now();
    const deterministic = input.input.kind === "text"
      ? parseDeterministicFlashcards(input.input.text.text, this.config.extractionMaxCount)
      : null;
    const shards = deterministic ? [] : shardTextContent(input.contents);
    const responses = deterministic ? [] : await runResilientBatches({
      total: shards.length,
      batchSize: 1,
      signal,
      run: ({ start }) => this.contentService.generateStructured({
        contents: shards[start]!,
        responseSchema: flashcardExtractionProviderResponseSchema,
        trustedSystemInstruction: buildFlashcardExtractInstruction(),
        operation: "extract",
        maxItems: this.config.extractionMaxCount,
        signal,
      }),
    });
    const responseData = deterministic ?? {
      items: responses.flatMap((response) => response.data.items),
      skippedItems: responses.flatMap((response) => response.data.skippedItems),
      truncated: responses.some((response) => response.data.truncated),
      uncertainties: responses.flatMap((response) => response.data.uncertainties),
    };
    const providerMeta = deterministic
      ? { provider: "deterministic", model: "local-parser", transport: "inline" as const }
      : responses[0]?.meta ?? { provider: "unknown", model: "unknown" };
    if (!responseData.items.length && input.input.kind === "text" &&
      (input.input.text.text.match(/(?:^|\n)\s*(?:q(?:uestion)?|front|term|concept)\s*[:：-]/giu)?.length ?? 0) >= 2) {
      throw new AIServiceError("AI_EXTRACTION_INCOMPLETE", {
        publicMessage: "The source contains Flashcard markers, but the AI extraction was incomplete.",
        diagnosticMessage: "Non-empty Flashcard source produced zero candidates after the deterministic route was unavailable.",
      });
    }
    const normalized = normalizeExtractedFlashcards(responseData, input, this.candidateId);
    let items = applyFlashcardBatchDuplicateWarnings(normalized.items);
    const skippedItems = normalized.skippedItems.slice(0, this.config.maxSkippedItems);
    const warnings = [
      ...normalized.warnings,
      ...responseData.uncertainties.map((value) => `Model uncertainty: ${value}`),
    ];
    if (normalized.skippedItems.length > this.config.maxSkippedItems) {
      warnings.push("Skipped source items exceeded the configured reporting limit.");
    }
    const truncated = responseData.truncated || responseData.items.length > this.config.extractionMaxCount;
    if (responseData.items.length > this.config.extractionMaxCount) {
      warnings.push("Extraction exceeded the configured maximum and was truncated.");
    }
    items = items.slice(0, this.config.extractionMaxCount);
    if (items.length < normalized.items.length) {
      warnings.push("Extraction candidates were truncated to the configured maximum.");
    }
    return baseResult("extract", items, skippedItems, warnings, providerMeta, startedAt, undefined, truncated);
  }

  async generateFlashcards(
    input: PreparedAIInput,
    options?: FlashcardGenerationOptions,
    signal?: AbortSignal,
  ): Promise<FlashcardOperationResult> {
    const selected = requiredGenerationOptions(options, this.config);
    const startedAt = performance.now();
    const coverageSources = shardTextContent(input.contents, 12_000);
    const initialBatchCount = Math.ceil(selected.count / 20);
    const coverage = (start: number, recovery = false) => {
      const sequence = (recovery ? initialBatchCount : 0) + Math.floor(start / 20);
      const sourceIndex = coverageSources.length === 1
        ? 0
        : Math.min(
          coverageSources.length - 1,
          Math.floor((sequence % initialBatchCount) * coverageSources.length / initialBatchCount),
        );
      return {
        contents: coverageSources[sourceIndex]!,
        instruction: `Source coverage window ${sequence + 1}; focus on bounded source segment ${sourceIndex + 1} of ${coverageSources.length} and avoid concepts covered by earlier windows.`,
      };
    };
    let responses = await runResilientBatches({
      total: selected.count,
      batchSize: 20,
      signal,
      run: ({ start, count }) => {
        const covered = coverage(start);
        return this.contentService.generateStructured({
          contents: covered.contents,
          responseSchema: flashcardGenerationProviderResponseSchema,
          trustedSystemInstruction: [
            buildFlashcardGenerateInstruction({ ...selected, count }),
            covered.instruction,
          ].join("\n\n"),
          operation: "generate",
          requestedCount: count,
          maxItems: count,
          signal,
        });
      },
    });
    const returnedBeforeRecovery = responses.reduce((total, response) => total + response.data.items.length, 0);
    if (returnedBeforeRecovery < selected.count) {
      const deficit = selected.count - returnedBeforeRecovery;
      const recovery = await runResilientBatches({
        total: deficit,
        batchSize: 20,
        signal,
        run: ({ start, count }) => {
          const covered = coverage(start, true);
          return this.contentService.generateStructured({
            contents: covered.contents,
            responseSchema: flashcardGenerationProviderResponseSchema,
            trustedSystemInstruction: [
              buildFlashcardGenerateInstruction({ ...selected, count }),
              covered.instruction,
              "This is bounded deficit recovery. Use source material not already covered and do not repeat an earlier card.",
            ].join("\n\n"),
            operation: "generate",
            requestedCount: count,
            maxItems: count,
            signal,
          });
        },
      });
      responses = [...responses, ...recovery];
    }
    const normalized = responses.flatMap((response) => normalizeGeneratedFlashcards(
      response.data,
      input,
      this.candidateId,
    ));
    const items = applyFlashcardBatchDuplicateWarnings(
      normalized,
    );
    const warnings = responses.flatMap((response) => response.data.uncertainties.map((value) => `Model uncertainty: ${value}`));
    if (items.some((item) => item.warnings.includes("Flashcard front duplicates another item in this result batch."))) {
      warnings.push("Duplicate generated Flashcards were retained for review rather than silently discarded.");
    }
    if (items.length < selected.count) {
      warnings.push(`Requested ${selected.count} Flashcards but only ${items.length} source-grounded Flashcards were generated.`);
    }
    return baseResult("generate", items, [], warnings, responses[0]?.meta ?? { provider: "unknown", model: "unknown" }, startedAt, selected.count);
  }

  async enhanceExistingFlashcards(
    input: PreparedAIInput,
    options?: FlashcardEnhancementOptions,
    signal?: AbortSignal,
  ): Promise<FlashcardOperationResult> {
    const startedAt = performance.now();
    requiredEnhancementOptions(options);
    const extraction = await this.extractExistingFlashcards(input, signal);
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

    const responses = await runResilientBatches({
      total: eligible.length,
      batchSize: 20,
      signal,
      run: ({ start, count }) => this.contentService.generateStructured({
        contents: input.contents,
        responseSchema: flashcardEnhancementProviderResponseSchema,
        trustedSystemInstruction: buildFlashcardEnhanceInstruction(),
        additionalUntrustedContext: enhancementContext(eligible.slice(start, start + count)),
        operation: "enhance",
        maxItems: count,
        signal,
      }),
      onFailure: (batch) => {
        warnings.push(`Enhancement batch ${batch.start + 1}-${batch.start + batch.count} could not be completed; original cards were retained.`);
      },
    });
    let response: FlashcardEnhancementProviderResponse = {
      items: responses.flatMap((result) => result.data.items),
      uncertainties: responses.flatMap((result) => result.data.uncertainties),
    };
    const hasUnknownCandidateId = response.items.some((item) => !eligible.some((candidate) => candidate.candidateId === item.candidateId));
    const recoveredIds = new Set(response.items.map((item) => item.candidateId));
    const missing = eligible.filter((item) => !recoveredIds.has(item.candidateId));
    if (missing.length > 0 && !hasUnknownCandidateId) {
      const recovery = await runResilientBatches({
        total: missing.length,
        batchSize: 20,
        signal,
        run: ({ start, count }) => this.contentService.generateStructured({
          contents: input.contents,
          responseSchema: flashcardEnhancementProviderResponseSchema,
          trustedSystemInstruction: [
            buildFlashcardEnhanceInstruction(),
            "This is bounded missing-candidate recovery. Return only the requested candidate IDs.",
          ].join("\n\n"),
          additionalUntrustedContext: enhancementContext(missing.slice(start, start + count)),
          operation: "enhance",
          maxItems: count,
          signal,
        }),
        onFailure: (batch) => {
          warnings.push(`Missing enhancement recovery ${batch.start + 1}-${batch.start + batch.count} failed; original cards were retained.`);
        },
      });
      response = {
        items: [...response.items, ...recovery.flatMap((result) => result.data.items)],
        uncertainties: [...response.uncertainties, ...recovery.flatMap((result) => result.data.uncertainties)],
      };
    }
    const eligibleIds = new Set(eligible.map((candidate) => candidate.candidateId));
    if (hasUnknownCandidateId) {
      warnings.push("Enhancement response contained an unknown candidate ID.");
    }
    const merged = this.mergeEnhancements(candidates, eligible, response, input);
    return baseResult(
      "enhance",
      applyFlashcardBatchDuplicateWarnings(merged),
      extraction.skippedItems,
      warnings.concat(response.uncertainties.map((value) => `Model uncertainty: ${value}`)),
      responses[0]?.meta ?? extraction.provider,
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