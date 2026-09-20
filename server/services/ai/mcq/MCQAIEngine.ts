import { randomUUID } from "node:crypto";
import type { PreparedAIInput } from "../input/contracts.js";
import { AIContentService } from "../AIContentService.js";
import { AIServiceError } from "../errors.js";
import type {
  AIMCQCandidate,
  MCQAIEngineInput,
  MCQEnhancementOptions,
  MCQGenerationOptions,
  MCQOperationResult,
  MCQExtractOptions,
  SkippedMCQSourceItem,
} from "./contracts.js";
import {
  DEFAULT_MCQ_ENGINE_CONFIG,
  MCQ_PROMPT_VERSION,
  type MCQEngineConfig,
} from "./config.js";
import {
  createMCQEnhancementProviderResponseSchema,
  mcqEnhancementProviderResponseSchema,
  mcqExtractionProviderResponseSchema,
  mcqGenerationProviderResponseSchema,
  type MCQEnhancementProviderResponse,
} from "./schemas.js";
import {
  buildMCQEnhanceInstruction,
  buildMCQExtractInstruction,
  buildMCQGenerateInstruction,
} from "./promptBuilder.js";
import { applyBatchDuplicateWarnings, applyQualityWarnings, summarizeCounts } from "./quality.js";
import { normalizeExtractedItems, normalizeGeneratedItems } from "./normalize.js";
import { parseDeterministicMCQs } from "./deterministicExtract.js";
import { runResilientBatches, shardTextContent } from "../reliability.js";

function inputForPrepared(input: PreparedAIInput): MCQAIEngineInput {
  return {
    contents: input.contents,
    inputKind: input.input.kind,
    imageCount: input.input.kind === "image" ? input.input.images.length : undefined,
    text: input.input.kind === "text" ? input.input.text.text : undefined,
  };
}

function requiredGenerationOptions(
  options: MCQGenerationOptions | undefined,
  config: MCQEngineConfig,
): Required<MCQGenerationOptions> {
  const count = options?.count ?? config.generationDefaultCount;
  if (!Number.isInteger(count) || count < 1 || count > config.generationMaxCount) {
    throw new AIServiceError("AI_VALIDATION_ERROR", {
      publicMessage: `MCQ generation count must be between 1 and ${config.generationMaxCount}.`,
      diagnosticMessage: "MCQ generation count was outside the configured range.",
    });
  }
  if (!options?.questionStyle) {
    throw new AIServiceError("AI_VALIDATION_ERROR", {
      publicMessage: "A question style is required for MCQ generation.",
      diagnosticMessage: "MCQ generation options omitted questionStyle.",
    });
  }
  return {
    count,
    difficulty: options.difficulty ?? "mixed",
    questionStyle: options.questionStyle,
    includeHints: options.includeHints,
    includeExplanations: options.includeExplanations,
  };
}

function requiredEnhancementOptions(options: MCQEnhancementOptions): Required<Pick<MCQEnhancementOptions, "hint" | "explanation">> {
  if (options.hint !== true && options.explanation !== true) {
    throw new AIServiceError("AI_VALIDATION_ERROR", {
      publicMessage: "Select at least one MCQ enhancement field.",
      diagnosticMessage: "Enhancement requires hint or explanation.",
    });
  }
  return { hint: options.hint === true, explanation: options.explanation === true };
}

function baseResult(
  operation: MCQOperationResult["operation"],
  items: AIMCQCandidate[],
  skippedItems: SkippedMCQSourceItem[],
  warnings: string[],
  provider: MCQOperationResult["provider"],
  startedAt: number,
  requestedCount?: number,
  truncated = false,
): MCQOperationResult {
  return {
    operation,
    promptVersion: MCQ_PROMPT_VERSION,
    items,
    skippedItems,
    truncated,
    warnings: [...new Set(warnings)],
    requiresHumanApproval: true,
    counts: {
      ...(requestedCount === undefined ? {} : { requestedCount }),
      ...summarizeCounts(items, skippedItems.length),
    },
    provider,
    processing: { durationMs: Math.max(0, performance.now() - startedAt) },
  };
}

function enhancementContext(items: AIMCQCandidate[]): string {
  return JSON.stringify({
    purpose: "untrusted extracted MCQ candidates for enhancement",
    candidates: items.map((item) => ({
      candidateId: item.candidateId,
      question: item.question,
      optionA: item.optionA,
      optionB: item.optionB,
      optionC: item.optionC,
      optionD: item.optionD,
      correctAnswer: item.correctAnswer,
      hint: item.hint,
      explanation: item.explanation,
      source: item.source,
    })),
  });
}

export class MCQAIEngine {
  constructor(
    private readonly contentService: AIContentService,
    private readonly config: MCQEngineConfig = DEFAULT_MCQ_ENGINE_CONFIG,
    private readonly candidateId: () => string = randomUUID,
  ) {}

  async extractExistingMCQs(input: PreparedAIInput, signal?: AbortSignal, metadata?: MCQExtractOptions): Promise<MCQOperationResult> {
    return this.extractFromEngineInput(inputForPrepared(input), signal, metadata);
  }

  private async extractFromEngineInput(input: MCQAIEngineInput, signal?: AbortSignal, metadata?: MCQExtractOptions): Promise<MCQOperationResult> {
    const startedAt = performance.now();
    const deterministic = input.text ? parseDeterministicMCQs(input.text, this.config.extractionMaxCount) : null;
    const shards = deterministic ? [] : shardTextContent(input.contents);
    const responses = deterministic ? [] : await runResilientBatches({
      total: shards.length,
      batchSize: 1,
      signal,
      run: ({ start }) => this.contentService.generateStructured({
        contents: shards[start]!,
        responseSchema: mcqExtractionProviderResponseSchema,
        trustedSystemInstruction: buildMCQExtractInstruction(),
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
    if (!responseData.items.length && input.text && (input.text.match(/(?:^|\n)\s*(?:q(?:uestion)?\s*)?\d{1,3}\s*[.)、:：-]/giu)?.length ?? 0) >= 2) {
      throw new AIServiceError("AI_EXTRACTION_INCOMPLETE", {
        publicMessage: "The source contains question markers, but the AI extraction was incomplete.",
        diagnosticMessage: "Non-empty numbered MCQ source produced zero candidates after the deterministic route was unavailable.",
      });
    }
    const normalized = normalizeExtractedItems(
      responseData,
      input,
      this.candidateId,
      metadata,
    );
    let items = applyBatchDuplicateWarnings(normalized.items);
    const skippedItems = normalized.skippedItems.slice(0, this.config.maxSkippedItems);
    const warnings = [...responseData.uncertainties.map((value) => `Model uncertainty: ${value}`), ...responseData.items.length > this.config.extractionMaxCount
      ? ["Extraction exceeded the configured maximum and was truncated."]
      : []];
    if (normalized.skippedItems.length > this.config.maxSkippedItems) {
      warnings.push("Skipped source items exceeded the configured reporting limit.");
    }
    const truncated = responseData.truncated || responseData.items.length > this.config.extractionMaxCount;
    items = items.slice(0, this.config.extractionMaxCount);
    if (items.length < normalized.items.length) warnings.push("Extraction candidates were truncated to the configured maximum.");
    return baseResult("extract", items, skippedItems, warnings, providerMeta, startedAt, undefined, truncated);
  }

  async generateMCQs(
    input: PreparedAIInput,
    options?: MCQGenerationOptions,
    signal?: AbortSignal,
  ): Promise<MCQOperationResult> {
    const selected = requiredGenerationOptions(options, this.config);
    const startedAt = performance.now();
    let responses = await runResilientBatches({
      total: selected.count,
      batchSize: 20,
      signal,
      run: ({ count }) => this.contentService.generateStructured({
        contents: input.contents,
        responseSchema: mcqGenerationProviderResponseSchema,
        trustedSystemInstruction: buildMCQGenerateInstruction({ ...selected, count }),
        operation: "generate",
        requestedCount: count,
        maxItems: count,
        signal,
      }),
    });
    const returnedBeforeRecovery = responses.reduce((total, response) => total + response.data.items.length, 0);
    if (returnedBeforeRecovery < selected.count) {
      const deficit = selected.count - returnedBeforeRecovery;
      const recovery = await runResilientBatches({
        total: deficit,
        batchSize: 20,
        signal,
        run: ({ count }) => this.contentService.generateStructured({
          contents: input.contents,
          responseSchema: mcqGenerationProviderResponseSchema,
          trustedSystemInstruction: [
            buildMCQGenerateInstruction({ ...selected, count }),
            "This is bounded deficit recovery. Use source material not already covered and do not repeat an earlier question.",
          ].join("\n\n"),
          operation: "generate",
          requestedCount: count,
          maxItems: count,
          signal,
        }),
      });
      responses = [...responses, ...recovery];
    }
    const provider = responses[0]?.meta ?? { provider: "unknown", model: "unknown" };
    const normalized = responses.flatMap((response) => normalizeGeneratedItems(
      response.data,
      input,
      selected,
      this.candidateId,
    ));
    const items = applyBatchDuplicateWarnings(normalized);
    const warnings = [
      ...responses.flatMap((response) => response.data.uncertainties.map((value) => `Model uncertainty: ${value}`)),
    ];
    if (items.some((item) => item.warnings.includes("Question duplicates another item in this result batch."))) {
      warnings.push("Duplicate generated questions were retained for review and not counted as silently valid content.");
    }
    if (items.length < selected.count) {
      warnings.push(`Requested ${selected.count} questions but only ${items.length} source-grounded questions were generated.`);
    }
    return baseResult("generate", items, [], warnings, provider, startedAt, selected.count);
  }

  async enhanceExistingMCQs(
    input: PreparedAIInput,
    options: MCQEnhancementOptions,
    signal?: AbortSignal,
  ): Promise<MCQOperationResult> {
    const startedAt = performance.now();
    const selected = requiredEnhancementOptions(options);
    const extraction = await this.extractExistingMCQs(input, signal, {
      category: options.category ?? "AI_GENERATED",
      difficulty: options.difficulty ?? "Medium",
    });
    const candidates = extraction.items.map((item) => ({ ...item }));
    const eligible = candidates.filter((item) =>
      item.correctAnswer !== null &&
      ((!selected.hint && !selected.explanation) ||
        (selected.hint && item.hint === null) ||
        (selected.explanation && item.explanation === null)),
    );
    let provider = extraction.provider;
    const warnings = [...extraction.warnings];
    if (eligible.length > 0) {
      const responses = await runResilientBatches({
        total: eligible.length,
        batchSize: 20,
        signal,
        run: ({ start, count }) => {
          const batch = eligible.slice(start, start + count);
          return this.contentService.generateStructured({
            contents: input.contents,
            responseSchema: createMCQEnhancementProviderResponseSchema(selected),
            trustedSystemInstruction: buildMCQEnhanceInstruction(selected),
            additionalUntrustedContext: enhancementContext(batch),
            operation: "enhance",
            maxItems: count,
            signal,
          });
        },
        onFailure: (batch) => {
          warnings.push(`Enhancement batch ${batch.start + 1}-${batch.start + batch.count} could not be completed; original candidates were retained.`);
        },
      });
      provider = responses[0]?.meta ?? provider;
      let mergedResponse: MCQEnhancementProviderResponse = {
        items: responses.flatMap((response) => response.data.items),
        uncertainties: responses.flatMap((response) => response.data.uncertainties),
      };
      const hasUnknownCandidateId = mergedResponse.items.some((item) =>
        !eligible.some((candidate) => candidate.candidateId === item.candidateId));
      const recoveredIds = new Set(mergedResponse.items.map((item) => item.candidateId));
      const missing = eligible.filter((item) => !recoveredIds.has(item.candidateId));
      if (missing.length > 0 && !hasUnknownCandidateId) {
        const recovery = await runResilientBatches({
          total: missing.length,
          batchSize: 20,
          signal,
          run: ({ start, count }) => this.contentService.generateStructured({
            contents: input.contents,
            responseSchema: createMCQEnhancementProviderResponseSchema(selected),
            trustedSystemInstruction: [
              buildMCQEnhanceInstruction(selected),
              "This is bounded missing-candidate recovery. Return only the requested candidate IDs.",
            ].join("\n\n"),
            additionalUntrustedContext: enhancementContext(missing.slice(start, start + count)),
            operation: "enhance",
            maxItems: count,
            signal,
          }),
          onFailure: (batch) => {
            warnings.push(`Missing enhancement recovery ${batch.start + 1}-${batch.start + batch.count} failed; original candidates were retained.`);
          },
        });
        mergedResponse = {
          items: [...mergedResponse.items, ...recovery.flatMap((response) => response.data.items)],
          uncertainties: [...mergedResponse.uncertainties, ...recovery.flatMap((response) => response.data.uncertainties)],
        };
      }
      const merged = this.mergeEnhancements(candidates, eligible, mergedResponse, selected, warnings);
      return baseResult(
        "enhance",
        applyBatchDuplicateWarnings(merged),
        extraction.skippedItems,
        warnings,
        provider,
        startedAt,
        undefined,
        extraction.truncated,
      );
    }
    warnings.push("No extracted MCQs were eligible for the requested enhancement.");
    return baseResult(
      "enhance",
      applyBatchDuplicateWarnings(candidates.map((candidate) => applyQualityWarnings(
        { ...candidate, provenance: "enhanced" as const },
        { requireAnswer: false, requestedHint: false, requestedExplanation: false },
      ))),
      extraction.skippedItems,
      warnings,
      provider,
      startedAt,
      undefined,
      extraction.truncated,
    );
  }

  private mergeEnhancements(
    candidates: AIMCQCandidate[],
    eligible: AIMCQCandidate[],
    response: MCQEnhancementProviderResponse,
    options: Required<Pick<MCQEnhancementOptions, "hint" | "explanation">>,
    warnings: string[],
  ): AIMCQCandidate[] {
    const eligibleIds = new Set(eligible.map((candidate) => candidate.candidateId));
    const resultById = new Map(response.items.map((item) => [item.candidateId, item]));
    for (const item of response.items) {
      if (!eligibleIds.has(item.candidateId)) warnings.push("Enhancement response contained an unknown candidate ID.");
    }
    return candidates.map((candidate) => {
      const stage2 = resultById.get(candidate.candidateId);
      const candidateWarnings = [...candidate.warnings];
      let hint = candidate.hint;
      let explanation = candidate.explanation;
      if (eligibleIds.has(candidate.candidateId)) {
        if (!stage2) {
          candidateWarnings.push("No enhancement result was returned for this candidate.");
        } else {
          if (options.hint && candidate.hint === null) hint = stage2.hint ?? null;
          if (options.explanation && candidate.explanation === null) explanation = stage2.explanation ?? null;
          candidateWarnings.push(...stage2.uncertainties.map((value) => `Model uncertainty: ${value}`));
          if (options.hint && candidate.hint === null && !stage2.hint) {
            candidateWarnings.push("The requested hint enhancement is missing.");
          }
          if (options.explanation && candidate.explanation === null && !stage2.explanation) {
            candidateWarnings.push("The requested explanation enhancement is missing.");
          }
          if (stage2.confidence < this.config.reviewConfidenceThreshold) {
            candidateWarnings.push("Enhancement confidence is below the review threshold.");
          }
        }
      }
      return applyQualityWarnings({
        ...candidate,
        provenance: "enhanced" as const,
        hint,
        explanation,
        warnings: [...new Set(candidateWarnings)],
      }, {
        requireAnswer: false,
        requestedHint: false,
        requestedExplanation: false,
        reviewConfidenceThreshold: this.config.reviewConfidenceThreshold,
      });
    });
  }
}