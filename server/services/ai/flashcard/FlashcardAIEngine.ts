import { randomUUID } from "node:crypto";
import type { AIContentPart, PreparedAIInput } from "../input/contracts.js";
import type { StructuredGenerationResult } from "../contracts.js";
import { AIContentService } from "../AIContentService.js";
import { AIServiceError } from "../errors.js";
import type {
  AIFlashcardCandidate,
  FlashcardEnhancementOptions,
  FlashcardEnhancementInput,
  FlashcardGenerationOptions,
  FlashcardOperationResult,
  FlashcardSourceEvidence,
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
  type FlashcardExtractionProviderResponse,
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
import { sha256Text } from "../input/hash.js";

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
  status: FlashcardOperationResult["status"] = items.length ? "complete" : "empty",
): FlashcardOperationResult {
  return {
    operation,
    promptVersion: FLASHCARD_PROMPT_VERSION,
    status,
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

function textContentsFromPreparedText(text: string, label: string): AIContentPart[] {
  return [{
    kind: "text",
    text,
    source: { inputType: "text", section: label, label },
    sizeBytes: new TextEncoder().encode(text).byteLength,
    sha256: sha256Text(text),
  }];
}

async function preferredSourceContents(
  contentService: AIContentService,
  input: PreparedAIInput,
  signal?: AbortSignal,
): Promise<{
  contents: AIContentPart[];
  preparedText: string | null;
  providerMeta?: FlashcardOperationResult["provider"];
}> {
  if (input.input.kind === "text") {
    return { contents: input.contents, preparedText: input.input.text.text };
  }
  const prepared = await contentService.prepareSourceText(input.contents, signal);
  const text = prepared?.text?.trim() ?? "";
  if (text) {
    return {
      contents: textContentsFromPreparedText(text, `Prepared ${input.input.kind} source text`),
      preparedText: text,
      providerMeta: prepared.meta,
    };
  }
  return { contents: input.contents, preparedText: null, ...(prepared ? { providerMeta: prepared.meta } : {}) };
}

function fallbackFlashcardEnhancementSource(
  candidate: AIFlashcardCandidate,
  source: PreparedAIInput,
): FlashcardSourceEvidence | null {
  const excerpt = [candidate.clinicalConcept, candidate.explanation ?? ""].filter(Boolean).join("\n").slice(0, 300);
  if (source.input.kind === "pdf") return { inputType: "pdf", section: "Flashcard enhancement candidate", supportingExcerpt: excerpt };
  if (source.input.kind === "image" && source.input.images.length === 1) {
    return { inputType: "image", imageIndex: 0, label: "Uploaded Flashcard image", supportingExcerpt: excerpt };
  }
  if (source.input.kind === "text") return { inputType: "text", section: "Flashcard enhancement candidate", supportingExcerpt: excerpt };
  return null;
}

function withRecoveredFlashcardEnhancementSource(
  candidate: AIFlashcardCandidate,
  source: PreparedAIInput,
): AIFlashcardCandidate {
  if (candidate.source) return candidate;
  const recovered = fallbackFlashcardEnhancementSource(candidate, source);
  if (!recovered) return candidate;
  const removable = new Set([
    "Source evidence was not provided.",
    "Source evidence input type did not match the supplied source.",
    "PDF source evidence did not contain a page or excerpt.",
    "Image source evidence contained an invalid image index.",
  ]);
  return {
    ...candidate,
    source: recovered,
    warnings: candidate.warnings.filter((warning) => !removable.has(warning)),
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
    let sourceStatus: FlashcardOperationResult["status"] = "complete";
    let deterministicProviderMeta: FlashcardOperationResult["provider"] = {
      provider: "deterministic",
      model: "local-parser",
      transport: "inline",
    };
    let deterministic = input.input.kind === "text"
      ? parseDeterministicFlashcards(input.input.text.text, this.config.extractionMaxCount)
      : null;
    const preferred = deterministic ? { contents: input.contents, preparedText: input.input.kind === "text" ? input.input.text.text : null, providerMeta: undefined as FlashcardOperationResult["provider"] | undefined } : await preferredSourceContents(this.contentService, input, signal);

    if (!deterministic && preferred.preparedText) {
      const parsed = parseDeterministicFlashcards(preferred.preparedText, this.config.extractionMaxCount);
      if (parsed) {
        deterministic = {
          ...parsed,
          items: parsed.items.map((item) => ({
            ...item,
            source: item.source ? {
              ...item.source,
              inputType: input.input.kind,
              ...(input.input.kind === "image" && input.input.images.length === 1 ? { imageIndex: 0 } : {}),
            } : item.source,
          })),
          skippedItems: parsed.skippedItems.map((item) => ({
            ...item,
            source: item.source ? {
              ...item.source,
              inputType: input.input.kind,
              ...(input.input.kind === "image" && input.input.images.length === 1 ? { imageIndex: 0 } : {}),
            } : item.source,
          })),
        };
        deterministicProviderMeta = preferred.providerMeta ?? deterministicProviderMeta;
      }
    }
    const shards = deterministic ? [] : shardTextContent(preferred.contents);
    const extractShard = async (contents: PreparedAIInput["contents"]): Promise<StructuredGenerationResult<FlashcardExtractionProviderResponse>[]> => {
      try {
        return [await this.contentService.generateStructured({
          contents,
          responseSchema: flashcardExtractionProviderResponseSchema,
          trustedSystemInstruction: buildFlashcardExtractInstruction(),
          operation: "extract",
          maxItems: this.config.extractionMaxCount,
          signal,
        })];
      } catch (error) {
        const part = contents.length === 1 && contents[0]?.kind === "text" ? contents[0] : null;
        if (!part || part.sizeBytes < 2_000) throw error;
        const halves = shardTextContent(contents, Math.ceil(part.sizeBytes / 2));
        if (halves.length < 2) throw error;
        const recovered = [];
        for (const half of halves) recovered.push(...await extractShard(half));
        return recovered;
      }
    };
    let responses = deterministic ? [] : (await runResilientBatches({
      total: shards.length,
      batchSize: 1,
      concurrency: 3,
      signal,
      run: async ({ start }) => extractShard(shards[start]!),
    })).flat();
    if (!deterministic && !responses.some((response) => response.data.items.length) &&
      preferred.preparedText &&
      (preferred.preparedText.match(/(?:^|\n)\s*(?:q(?:uestion)?|front|term|concept)\s*[:：-]/giu)?.length ?? 0) >= 2) {
      const recovery = await this.contentService.generateStructured({
        contents: preferred.contents,
        responseSchema: flashcardExtractionProviderResponseSchema,
        trustedSystemInstruction: [
          buildFlashcardExtractInstruction(),
          "The previous bounded extraction returned zero items despite clear Flashcard markers. Retry extraction and return every recoverable card; do not finalize as empty.",
        ].join("\n\n"),
        operation: "extract",
        maxItems: this.config.extractionMaxCount,
        signal,
      });
      responses = [recovery];
    }
    if (!deterministic && !responses.some((response) => response.data.items.length)) {
      const recovery = await this.contentService.generateStructured({
        contents: preferred.contents,
        responseSchema: flashcardExtractionProviderResponseSchema,
        trustedSystemInstruction: [
          buildFlashcardExtractInstruction(),
          "The previous source pass returned zero cards. Retry the complete non-empty source once using every available page, OCR transcript, or converted segment.",
          "Do not finalize as a successful empty extraction unless the source is genuinely unreadable or contains no Flashcards.",
        ].join("\n\n"),
        operation: "extract",
        maxItems: this.config.extractionMaxCount,
        signal,
      });
      responses = [...responses, recovery];
      if (!recovery.data.items.length) sourceStatus = "incomplete";
    }
    const responseData = deterministic ?? {
      items: responses.flatMap((response) => response.data.items),
      skippedItems: responses.flatMap((response) => response.data.skippedItems),
      truncated: responses.some((response) => response.data.truncated),
      uncertainties: responses.flatMap((response) => response.data.uncertainties),
    };
    const providerMeta = deterministic
      ? deterministicProviderMeta
      : responses[0]?.meta ?? preferred.providerMeta ?? { provider: "unknown", model: "unknown" };
    if (!responseData.items.length && preferred.preparedText &&
      (preferred.preparedText.match(/(?:^|\n)\s*(?:q(?:uestion)?|front|term|concept)\s*[:：-]/giu)?.length ?? 0) >= 2) {
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
    if (!items.length && sourceStatus === "incomplete") {
      warnings.push("Visual or OCR source processing remained incomplete after bounded recovery; no candidates were finalized.");
    }
    return baseResult("extract", items, skippedItems, warnings, providerMeta, startedAt, undefined, truncated, items.length ? "complete" : sourceStatus === "incomplete" ? "incomplete" : "empty");
  }

  async generateFlashcards(
    input: PreparedAIInput,
    options?: FlashcardGenerationOptions,
    signal?: AbortSignal,
  ): Promise<FlashcardOperationResult> {
    const selected = requiredGenerationOptions(options, this.config);
    const startedAt = performance.now();
    const generationBatchSize = 20;
    const preferred = await preferredSourceContents(this.contentService, input, signal);
    const coverageSources = shardTextContent(preferred.contents, 10_000);
    const initialBatchCount = Math.ceil(selected.count / generationBatchSize);
    const coverage = (start: number, recovery = false) => {
      const sequence = (recovery ? initialBatchCount : 0) + Math.floor(start / generationBatchSize);
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
      batchSize: generationBatchSize,
      concurrency: 4,
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
          sourceWindowIndex: Math.floor(start / generationBatchSize),
          signal,
        });
      },
    });
    const returnedBeforeRecovery = responses.reduce((total, response) => total + response.data.items.length, 0);
    if (returnedBeforeRecovery < selected.count) {
      const deficit = selected.count - returnedBeforeRecovery;
      const recovery = await runResilientBatches({
        total: deficit,
        batchSize: generationBatchSize,
        concurrency: 4,
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
            sourceWindowIndex: initialBatchCount + Math.floor(start / generationBatchSize),
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
    if (!items.length) {
      warnings.push("The source did not support a source-grounded Flashcard result after bounded recovery.");
    }
    return baseResult(
      "generate",
      items,
      [],
      warnings,
      responses[0]?.meta ?? preferred.providerMeta ?? { provider: "unknown", model: "unknown" },
      startedAt,
      selected.count,
      false,
      items.length ? "complete" : "incomplete",
    );
  }

  async enhanceExistingFlashcards(
    input: PreparedAIInput | FlashcardEnhancementInput,
    options?: FlashcardEnhancementOptions,
    signal?: AbortSignal,
  ): Promise<FlashcardOperationResult> {
    const startedAt = performance.now();
    requiredEnhancementOptions(options);
    const source = "source" in input ? input.source : input;
    const extraction = "source" in input ? null : await this.extractExistingFlashcards(input, signal);
    const preferredSource = await preferredSourceContents(this.contentService, source, signal);
    const candidates = ("source" in input ? input.candidates : extraction!.items).map((item) =>
      withRecoveredFlashcardEnhancementSource({
        ...item,
        warnings: [...item.warnings],
      }, source));
    const eligible = candidates.filter((item) => item.clinicalConcept.trim() && item.explanation === null);
    const warnings = [...(extraction?.warnings ?? [])];

    if (eligible.length === 0) {
      warnings.push("No extracted Flashcards were eligible for explanation enhancement.");
      return baseResult(
        "enhance",
        applyFlashcardBatchDuplicateWarnings(candidates.map((candidate) => applyFlashcardQualityWarnings(
          { ...candidate },
          { requireExplanation: true, reviewConfidenceThreshold: Math.min(this.config.reviewConfidenceThreshold, 0.7) },
        ))),
        extraction?.skippedItems ?? [],
        warnings,
        extraction?.provider ?? { provider: "unknown", model: "unknown" },
        startedAt,
        undefined,
        extraction?.truncated ?? false,
      );
    }

    const responses = await runResilientBatches({
      total: eligible.length,
      batchSize: 20,
      concurrency: 4,
      signal,
      run: ({ start, count }) => this.contentService.generateStructured({
        contents: preferredSource.contents,
        responseSchema: flashcardEnhancementProviderResponseSchema,
        trustedSystemInstruction: buildFlashcardEnhanceInstruction(),
        additionalUntrustedContext: enhancementContext(eligible.slice(start, start + count)),
        operation: "enhance",
        maxItems: count,
        sourceWindowIndex: Math.floor(start / 20),
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
        concurrency: 4,
        signal,
        run: ({ start, count }) => this.contentService.generateStructured({
          contents: preferredSource.contents,
          responseSchema: flashcardEnhancementProviderResponseSchema,
          trustedSystemInstruction: [
            buildFlashcardEnhanceInstruction(),
            "This is bounded missing-candidate recovery. Return only the requested candidate IDs.",
          ].join("\n\n"),
          additionalUntrustedContext: enhancementContext(missing.slice(start, start + count)),
          operation: "enhance",
          maxItems: count,
          sourceWindowIndex: Math.floor(start / 20),
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
    const merged = this.mergeEnhancements(candidates, eligible, response, source);
    return baseResult(
      "enhance",
      applyFlashcardBatchDuplicateWarnings(merged),
      extraction?.skippedItems ?? [],
      warnings.concat(response.uncertainties.map((value) => `Model uncertainty: ${value}`)),
      responses[0]?.meta ?? preferredSource.providerMeta ?? extraction?.provider ?? { provider: "unknown", model: "unknown" },
      startedAt,
      undefined,
      extraction?.truncated ?? false,
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
      const source = candidate.source;
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
            candidateWarnings.push(...validatedSource.warnings);
          }
          if (stage2.confidence < Math.min(this.config.reviewConfidenceThreshold, 0.7)) {
            candidateWarnings.push("Enhancement confidence is below the review threshold.");
          }
        }
      }

      const enhancementApplied = Boolean(stage2 && explanation);
      const effectiveWarnings = candidateWarnings.filter((warning) =>
        !(explanation && warning === "The extracted Flashcard has no explicit explanation/back.") &&
        !(explanation && warning === "The Flashcard explanation is missing."));
      return applyFlashcardQualityWarnings({
        ...candidate,
        explanation,
        source,
        confidence,
        provenance: enhancementApplied ? "enhanced" as const : candidate.provenance,
        needsReview: effectiveWarnings.length > 0,
        warnings: [...new Set(effectiveWarnings)],
      }, {
        requireExplanation: true,
        reviewConfidenceThreshold: Math.min(this.config.reviewConfidenceThreshold, 0.7),
      });
    });
  }
}