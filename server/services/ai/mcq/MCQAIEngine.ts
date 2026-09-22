import { randomUUID } from "node:crypto";
import type { PreparedAIInput } from "../input/contracts.js";
import { AIContentService } from "../AIContentService.js";
import { AIServiceError } from "../errors.js";
import type {
  AIMCQCandidate,
  MCQAIEngineInput,
  MCQEnhancementInput,
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
import { contiguousIndexRanges, planNumberedMCQExtraction } from "./extractionPlan.js";

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
  status: MCQOperationResult["status"] = items.length ? "complete" : "empty",
): MCQOperationResult {
  return {
    operation,
    promptVersion: MCQ_PROMPT_VERSION,
    status,
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

function explicitlyImpliedAnswer(text: string | null | undefined): "A" | "B" | "C" | "D" | null {
  const match = text?.match(/\b(?:correct\s+answer|answer|option)\s*(?:is|:|-)?\s*([A-D])\b/iu);
  return match ? match[1]!.toUpperCase() as "A" | "B" | "C" | "D" : null;
}

function mergeEnhancementItems(
  items: MCQEnhancementProviderResponse["items"],
): MCQEnhancementProviderResponse["items"] {
  const merged = new Map<string, MCQEnhancementProviderResponse["items"][number]>();
  for (const item of items) {
    const previous = merged.get(item.candidateId);
    if (!previous) {
      merged.set(item.candidateId, item);
      continue;
    }
    merged.set(item.candidateId, {
      ...previous,
      ...item,
      ...(item.hint === undefined && previous.hint !== undefined ? { hint: previous.hint } : {}),
      ...(item.explanation === undefined && previous.explanation !== undefined
        ? { explanation: previous.explanation }
        : {}),
    });
  }
  return [...merged.values()];
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
    let sourceStatus: MCQOperationResult["status"] = "complete";
    const deterministic = input.text ? parseDeterministicMCQs(input.text, this.config.extractionMaxCount) : null;
    const numberedPlan = deterministic ? null : planNumberedMCQExtraction(input.contents);
    const shards = deterministic || numberedPlan ? [] : shardTextContent(input.contents);
    let responses = deterministic ? [] : numberedPlan
      ? await runResilientBatches({
        total: numberedPlan.blocks.length,
        batchSize: 25,
        signal,
        run: async (batch) => ({
          batch,
          result: await this.contentService.generateStructured({
            contents: numberedPlan.contentsForRange(batch.start, batch.count),
            responseSchema: mcqExtractionProviderResponseSchema,
            trustedSystemInstruction: [
              buildMCQExtractInstruction(),
              `This bounded source range contains source ordinals ${numberedPlan.blocks.slice(batch.start, batch.start + batch.count).map((block) => block.ordinal).join(", ")}. Return sourceOrdinal for every extracted item.`,
            ].join("\n\n"),
            operation: "extract",
            maxItems: batch.count,
            signal,
          }),
        }),
      })
      : await runResilientBatches({
        total: shards.length,
        batchSize: 1,
        signal,
        run: async (batch) => ({
          batch,
          result: await this.contentService.generateStructured({
            contents: shards[batch.start]!,
            responseSchema: mcqExtractionProviderResponseSchema,
            trustedSystemInstruction: buildMCQExtractInstruction(),
            operation: "extract",
            maxItems: this.config.extractionMaxCount,
            signal,
          }),
        }),
      });
    if (numberedPlan) {
      const withSafeOrdinals = responses.flatMap(({ batch, result }) =>
        result.data.items.map((item, index) => ({
          ...item,
          ...(item.sourceOrdinal === undefined && result.data.items.length === batch.count
            ? { sourceOrdinal: numberedPlan.blocks[batch.start + index]?.ordinal }
            : {}),
        })));
      const found = new Set(withSafeOrdinals.map((item) => item.sourceOrdinal).filter((value): value is number => value !== undefined));
      const missingIndexes = numberedPlan.blocks
        .map((block, index) => found.has(block.ordinal) ? -1 : index)
        .filter((index) => index >= 0);
      for (const missingRange of contiguousIndexRanges(missingIndexes)) {
        const recovered = await runResilientBatches({
          total: missingRange.count,
          batchSize: Math.min(25, missingRange.count),
          signal,
          run: async (batch) => {
            const absolute = { start: missingRange.start + batch.start, count: batch.count };
            return {
              batch: absolute,
              result: await this.contentService.generateStructured({
                contents: numberedPlan.contentsForRange(absolute.start, absolute.count),
                responseSchema: mcqExtractionProviderResponseSchema,
                trustedSystemInstruction: [
                  buildMCQExtractInstruction(),
                  `Recover only missing source ordinals ${numberedPlan.blocks.slice(absolute.start, absolute.start + absolute.count).map((block) => block.ordinal).join(", ")}. Return sourceOrdinal for every item.`,
                ].join("\n\n"),
                operation: "extract",
                maxItems: absolute.count,
                signal,
              }),
            };
          },
        });
        responses = [...responses, ...recovered];
      }
    }
    const plannedItems = numberedPlan
      ? responses.flatMap(({ batch, result }) => result.data.items.map((item, index) => ({
        ...item,
        ...(item.sourceOrdinal === undefined && result.data.items.length === batch.count
          ? { sourceOrdinal: numberedPlan.blocks[batch.start + index]?.ordinal }
          : {}),
      })))
      : responses.flatMap((response) => response.result.data.items);
    const uniquePlannedItems = numberedPlan
      ? [...new Map(plannedItems.filter((item) => item.sourceOrdinal !== undefined).map((item) => [item.sourceOrdinal, item])).values()]
        .sort((left, right) => left.sourceOrdinal! - right.sourceOrdinal!)
      : plannedItems;
    if (numberedPlan) {
      const recovered = new Set(uniquePlannedItems.map((item) => item.sourceOrdinal));
      const missing = numberedPlan.blocks.filter((block) => !recovered.has(block.ordinal)).map((block) => block.ordinal);
      if (missing.length) {
        throw new AIServiceError("AI_EXTRACTION_INCOMPLETE", {
          publicMessage: `The AI extraction remained incomplete. Missing source items: ${missing.join(", ")}.`,
          diagnosticMessage: `Numbered MCQ recovery exhausted with ${missing.length} missing ordinal(s).`,
          retryable: true,
        });
      }
    }
    if (
      !deterministic &&
      !numberedPlan &&
      input.inputKind !== "text" &&
      !responses.some((response) => response.result.data.items.length)
    ) {
      const recovery = await this.contentService.generateStructured({
        contents: input.contents,
        responseSchema: mcqExtractionProviderResponseSchema,
        trustedSystemInstruction: [
          buildMCQExtractInstruction(),
          "The previous visual/document pass returned zero candidates. Retry the complete non-empty source once using every available page or image.",
          "Do not finalize as a successful empty extraction unless the source is genuinely unreadable or contains no MCQs.",
        ].join("\n\n"),
        operation: "extract",
        maxItems: this.config.extractionMaxCount,
        signal,
      });
      responses = [...responses, { batch: { start: 0, count: 1 }, result: recovery }];
      if (!recovery.data.items.length) sourceStatus = "incomplete";
    }
    const responseData = deterministic ?? {
      items: numberedPlan
        ? [...new Map(
          responses
            .flatMap(({ batch, result }) => result.data.items.map((item, index) => ({
              ...item,
              ...(item.sourceOrdinal === undefined && result.data.items.length === batch.count
                ? { sourceOrdinal: numberedPlan.blocks[batch.start + index]?.ordinal }
                : {}),
            })))
            .filter((item) => item.sourceOrdinal !== undefined)
            .map((item) => [item.sourceOrdinal, item]),
        ).values()].sort((left, right) => left.sourceOrdinal! - right.sourceOrdinal!)
        : responses.flatMap((response) => response.result.data.items),
      skippedItems: responses.flatMap((response) => response.result.data.skippedItems),
      truncated: responses.some((response) => response.result.data.truncated),
      uncertainties: responses.flatMap((response) => response.result.data.uncertainties),
    };
    const providerMeta = deterministic
      ? { provider: "deterministic", model: "local-parser", transport: "inline" as const }
      : responses[0]?.result.meta ?? { provider: "unknown", model: "unknown" };
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
    if (!items.length && sourceStatus === "incomplete") {
      warnings.push("Visual source processing remained incomplete after bounded recovery; no candidates were finalized.");
    }
    return baseResult("extract", items, skippedItems, warnings, providerMeta, startedAt, undefined, truncated, items.length ? "complete" : sourceStatus === "incomplete" ? "incomplete" : "empty");
  }

  async generateMCQs(
    input: PreparedAIInput,
    options?: MCQGenerationOptions,
    signal?: AbortSignal,
  ): Promise<MCQOperationResult> {
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
          responseSchema: mcqGenerationProviderResponseSchema,
          trustedSystemInstruction: [
            buildMCQGenerateInstruction({ ...selected, count }),
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
            responseSchema: mcqGenerationProviderResponseSchema,
            trustedSystemInstruction: [
              buildMCQGenerateInstruction({ ...selected, count }),
              covered.instruction,
              "This is bounded deficit recovery. Use source material not already covered and do not repeat an earlier question.",
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
    if (!items.length) {
      warnings.push("The source did not support a source-grounded MCQ result after bounded recovery.");
    }
    return baseResult(
      "generate",
      items,
      [],
      warnings,
      provider,
      startedAt,
      selected.count,
      false,
      items.length ? "complete" : "incomplete",
    );
  }

  async enhanceExistingMCQs(
    input: PreparedAIInput | MCQEnhancementInput,
    options: MCQEnhancementOptions,
    signal?: AbortSignal,
  ): Promise<MCQOperationResult> {
    const startedAt = performance.now();
    const selected = requiredEnhancementOptions(options);
    const source = "source" in input ? input.source : input;
    const extraction = "source" in input
      ? null
      : await this.extractExistingMCQs(input, signal, {
        category: options.category ?? "AI_GENERATED",
        difficulty: options.difficulty ?? "Medium",
      });
    const candidates = ("source" in input ? input.candidates : extraction!.items).map((item) => ({
      ...item,
      warnings: [...item.warnings],
    }));
    const eligible = candidates.filter((item) =>
      item.correctAnswer !== null &&
      ((!selected.hint && !selected.explanation) ||
        (selected.hint && item.hint === null) ||
        (selected.explanation && item.explanation === null)),
    );
    let provider = extraction?.provider ?? { provider: "unknown", model: "unknown" };
    const warnings = [...(extraction?.warnings ?? [])];
    if (eligible.length > 0) {
      const responses = await runResilientBatches({
        total: eligible.length,
        batchSize: 20,
        signal,
        run: ({ start, count }) => {
          const batch = eligible.slice(start, start + count);
          return this.contentService.generateStructured({
            contents: source.contents,
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
        items: mergeEnhancementItems(responses.flatMap((response) => response.data.items)),
        uncertainties: responses.flatMap((response) => response.data.uncertainties),
      };
      const hasUnknownCandidateId = mergedResponse.items.some((item) =>
        !eligible.some((candidate) => candidate.candidateId === item.candidateId));
      const responseById = new Map(mergedResponse.items.map((item) => [item.candidateId, item]));
      const missing = eligible.filter((item) => {
        const enhancement = responseById.get(item.candidateId);
        return !enhancement ||
          (selected.hint && item.hint === null && !enhancement.hint) ||
          (selected.explanation && item.explanation === null && !enhancement.explanation);
      });
      if (missing.length > 0 && !hasUnknownCandidateId) {
        const recovery = await runResilientBatches({
          total: missing.length,
          batchSize: 20,
          signal,
          run: ({ start, count }) => this.contentService.generateStructured({
            contents: source.contents,
            responseSchema: createMCQEnhancementProviderResponseSchema(selected),
            trustedSystemInstruction: [
              buildMCQEnhanceInstruction(selected),
              "This is bounded missing-field recovery. Return only the requested candidate IDs and fill every requested field that is still missing.",
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
          items: mergeEnhancementItems([
            ...mergedResponse.items,
            ...recovery.flatMap((response) => response.data.items),
          ]),
          uncertainties: [...mergedResponse.uncertainties, ...recovery.flatMap((response) => response.data.uncertainties)],
        };
      }
      const merged = this.mergeEnhancements(candidates, eligible, mergedResponse, selected, warnings);
      return baseResult(
        "enhance",
        applyBatchDuplicateWarnings(merged),
        extraction?.skippedItems ?? [],
        warnings,
        provider,
        startedAt,
        undefined,
        extraction?.truncated ?? false,
      );
    }
    warnings.push("No extracted MCQs were eligible for the requested enhancement.");
    return baseResult(
      "enhance",
      applyBatchDuplicateWarnings(candidates.map((candidate) => applyQualityWarnings(
        { ...candidate },
        {
          requireAnswer: false,
          requestedHint: selected.hint,
          requestedExplanation: selected.explanation,
          reviewConfidenceThreshold: this.config.reviewConfidenceThreshold,
        },
      ))),
      extraction?.skippedItems ?? [],
      warnings,
      provider,
      startedAt,
      undefined,
      extraction?.truncated ?? false,
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
      let confidence = candidate.confidence;
      if (eligibleIds.has(candidate.candidateId)) {
        if (!stage2) {
          candidateWarnings.push("No enhancement result was returned for this candidate.");
        } else {
          if (options.hint && candidate.hint === null) hint = stage2.hint ?? null;
          if (options.explanation && candidate.explanation === null) explanation = stage2.explanation ?? null;
          confidence = stage2.confidence;
          candidateWarnings.push(...stage2.uncertainties.map((value) => `Model uncertainty: ${value}`));
          const impliedAnswer = explicitlyImpliedAnswer(stage2.explanation);
          if (candidate.correctAnswer && impliedAnswer && impliedAnswer !== candidate.correctAnswer) {
            candidateWarnings.push(`The enhancement implies answer ${impliedAnswer}, but the source answer ${candidate.correctAnswer} was preserved.`);
          }
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
      const enhancementApplied = Boolean(
        stage2 &&
        (!options.hint || hint !== null) &&
        (!options.explanation || explanation !== null),
      );
      const effectiveWarnings = candidateWarnings.filter((warning) =>
        !(hint !== null && warning === "The requested hint is missing.") &&
        !(explanation !== null && warning === "The requested explanation is missing."));
      return applyQualityWarnings({
        ...candidate,
        provenance: enhancementApplied ? "enhanced" as const : candidate.provenance,
        hint,
        explanation,
        confidence,
        needsReview: effectiveWarnings.length > 0,
        warnings: [...new Set(effectiveWarnings)],
      }, {
        requireAnswer: false,
        requestedHint: options.hint,
        requestedExplanation: options.explanation,
        reviewConfidenceThreshold: this.config.reviewConfidenceThreshold,
      });
    });
  }
}