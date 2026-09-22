import { randomUUID } from "node:crypto";
import type { AIContentPart, PreparedAIInput } from "../input/contracts.js";
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
  MCQSourceEvidence,
  SkippedMCQSourceItem,
} from "./contracts.js";
import {
  DEFAULT_MCQ_ENGINE_CONFIG,
  MCQ_PROMPT_VERSION,
  type MCQEngineConfig,
} from "./config.js";
import {
  createMCQEnhancementProviderResponseSchema,
  createMCQRequiredEnhancementProviderResponseSchema,
  mcqEnhancementProviderResponseSchema,
  mcqExtractionProviderResponseSchema,
  mcqGenerationCompactProviderResponseSchema,
  type MCQEnhancementProviderResponse,
  type MCQGenerationCompactProviderResponse,
  type MCQGenerationProviderResponse,
  type MCQExtractionProviderResponse,
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
import { sha256Text } from "../input/hash.js";
import { hasHealthyLocalPdfText, readLocalPdfText } from "../input/localPdfText.js";

function inputForPrepared(input: PreparedAIInput): MCQAIEngineInput {
  return {
    contents: input.contents,
    inputKind: input.input.kind,
    imageCount: input.input.kind === "image" ? input.input.images.length : undefined,
    text: input.input.kind === "text" ? input.input.text.text : undefined,
  };
}

function remapDeterministicMCQSource(
  response: MCQExtractionProviderResponse,
  input: MCQAIEngineInput,
): MCQExtractionProviderResponse {
  if (input.inputKind === "text") return response;
  return {
    ...response,
    items: response.items.map((item) => ({
      ...item,
      source: item.source ? {
        ...item.source,
        inputType: input.inputKind,
        ...(input.inputKind === "image" && input.imageCount === 1 ? { imageIndex: 0 } : {}),
      } : item.source,
    })),
    skippedItems: response.skippedItems.map((item) => ({
      ...item,
      source: item.source ? {
        ...item.source,
        inputType: input.inputKind,
        ...(input.inputKind === "image" && input.imageCount === 1 ? { imageIndex: 0 } : {}),
      } : item.source,
    })),
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
  input: MCQAIEngineInput,
  signal?: AbortSignal,
  options: { fastTextPdf?: boolean } = {},
): Promise<{
  contents: AIContentPart[];
  preparedText: string | null;
  providerMeta?: MCQOperationResult["provider"];
}> {
  if (input.inputKind === "text") {
    return { contents: input.contents, preparedText: input.text ?? null };
  }
  if (options.fastTextPdf && input.inputKind === "pdf") {
    const local = await readLocalPdfText(input.contents, signal);
    if (hasHealthyLocalPdfText(local)) {
      return {
        contents: textContentsFromPreparedText(local.text, "Locally extracted PDF text"),
        preparedText: local.text,
        providerMeta: { provider: "local", model: "pdfjs-text", transport: "inline" },
      };
    }
  }
  const prepared = await contentService.prepareSourceText(input.contents, signal);
  const text = prepared?.text?.trim() ?? "";
  if (text) {
    return {
      contents: textContentsFromPreparedText(text, `Prepared ${input.inputKind} source text`),
      preparedText: text,
      providerMeta: prepared.meta,
    };
  }
  return { contents: input.contents, preparedText: null, ...(prepared ? { providerMeta: prepared.meta } : {}) };
}

function expandCompactGenerationResponse(
  response: MCQGenerationCompactProviderResponse,
): MCQGenerationProviderResponse {
  return {
    items: response.items.map((item) => ({
      ...item,
      source: null,
      confidence: 0.85,
      uncertainties: [],
    })),
    uncertainties: [],
  };
}

function generationCoverageWindows(contents: AIContentPart[], desiredWindows: number): AIContentPart[][] {
  const count = Math.max(1, desiredWindows);
  const part = contents.length === 1 && contents[0]?.kind === "text" ? contents[0] : null;
  if (!part || count === 1) return [contents];

  const pageBlocks = part.text
    .split(/(?=^\[PDF page \d+\]\s*$)/gmu)
    .map((value) => value.trim())
    .filter(Boolean);

  if (pageBlocks.length >= count) {
    const weights = pageBlocks.map((block) => Math.max(1, block.replace(/\s/gu, "").length));
    const prefix = [0];
    for (const weight of weights) prefix.push(prefix[prefix.length - 1]! + weight);
    const totalChars = prefix[prefix.length - 1]!;
    const boundaries = [0];
    let previous = 0;
    for (let split = 1; split < count; split += 1) {
      const minBoundary = previous + 1;
      const maxBoundary = pageBlocks.length - (count - split);
      const target = totalChars * split / count;
      let best = minBoundary;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let candidate = minBoundary; candidate <= maxBoundary; candidate += 1) {
        const distance = Math.abs(prefix[candidate]! - target);
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      }
      boundaries.push(best);
      previous = best;
    }
    boundaries.push(pageBlocks.length);

    return Array.from({ length: count }, (_, index) => {
      const text = pageBlocks.slice(boundaries[index]!, boundaries[index + 1]!).join("\n\n");
      return [{
        kind: "text" as const,
        text,
        source: part.source,
        sizeBytes: new TextEncoder().encode(text).byteLength,
        sha256: sha256Text(text),
      }];
    });
  }

  const byteLength = new TextEncoder().encode(part.text).byteLength;
  const targetBytes = Math.max(1_200, Math.ceil(byteLength / count));
  const sharded = shardTextContent(contents, targetBytes);
  return sharded.length > 1 ? sharded : [contents];
}

function meaningfulSourceCharacters(contents: AIContentPart[]): number {
  return contents.reduce((total, part) => total + (part.kind === "text" ? part.text.replace(/\s/gu, "").length : 0), 0);
}

function countQuestionMarkers(text: string | null | undefined): number {
  return text ? (text.match(/(?:^|\n)\s*(?:q(?:uestion)?\s*[iIl|]?\s*)?\d{1,3}\s*[.)、:：\/-]/giu)?.length ?? 0) : 0;
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

function fallbackEnhancementSource(
  candidate: AIMCQCandidate,
  source: PreparedAIInput,
): MCQSourceEvidence | null {
  const excerpt = [
    candidate.question,
    `A. ${candidate.optionA}`,
    `B. ${candidate.optionB}`,
    `C. ${candidate.optionC}`,
    `D. ${candidate.optionD}`,
  ].join("\n").slice(0, 300);
  if (source.input.kind === "pdf") {
    return { inputType: "pdf", section: "MCQ enhancement candidate", supportingExcerpt: excerpt };
  }
  if (source.input.kind === "image" && source.input.images.length === 1) {
    return { inputType: "image", imageIndex: 0, label: "Uploaded MCQ image", supportingExcerpt: excerpt };
  }
  if (source.input.kind === "text") {
    return { inputType: "text", section: "MCQ enhancement candidate", supportingExcerpt: excerpt };
  }
  return null;
}

function withRecoveredEnhancementSource(
  candidate: AIMCQCandidate,
  source: PreparedAIInput,
): AIMCQCandidate {
  if (candidate.source) return candidate;
  const recovered = fallbackEnhancementSource(candidate, source);
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
    let deterministicProviderMeta: MCQOperationResult["provider"] = {
      provider: "deterministic",
      model: "local-parser",
      transport: "inline",
    };
    let deterministic = input.text ? parseDeterministicMCQs(input.text, this.config.extractionMaxCount) : null;
    let preferred: Awaited<ReturnType<typeof preferredSourceContents>> = {
      contents: input.contents as AIContentPart[],
      preparedText: input.text ?? null,
    };

    if (!deterministic) {
      preferred = await preferredSourceContents(this.contentService, input, signal);
      if (preferred.preparedText) {
        const parsed = parseDeterministicMCQs(preferred.preparedText, this.config.extractionMaxCount);
        if (parsed) {
          deterministic = remapDeterministicMCQSource(parsed, input);
          deterministicProviderMeta = preferred.providerMeta ?? deterministicProviderMeta;
        }
      }
    }

    const numberedPlan = deterministic ? null : planNumberedMCQExtraction(preferred.contents);
    const shards = deterministic || numberedPlan ? [] : shardTextContent(preferred.contents);
    let responses = deterministic ? [] : numberedPlan
      ? await runResilientBatches({
        total: numberedPlan.blocks.length,
        batchSize: 20,
        concurrency: 4,
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
        concurrency: 3,
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
          batchSize: Math.min(20, missingRange.count),
          concurrency: 4,
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

    const hasAnyResponseItems = responses.some((response) => response.result.data.items.length);
    if (!deterministic && !numberedPlan && !hasAnyResponseItems) {
      const recovery = await this.contentService.generateStructured({
        contents: preferred.contents,
        responseSchema: mcqExtractionProviderResponseSchema,
        trustedSystemInstruction: [
          buildMCQExtractInstruction(),
          "The previous source pass returned zero candidates. Retry the complete non-empty source once using every available page, OCR transcript, or converted segment.",
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
      ? deterministicProviderMeta
      : responses[0]?.result.meta ?? preferred.providerMeta ?? { provider: "unknown", model: "unknown" };
    if (!responseData.items.length && countQuestionMarkers(preferred.preparedText ?? input.text ?? undefined) >= 2) {
      throw new AIServiceError("AI_EXTRACTION_INCOMPLETE", {
        publicMessage: "The source contains question markers, but the AI extraction was incomplete.",
        diagnosticMessage: "Non-empty numbered MCQ source produced zero candidates after deterministic and structured recovery.",
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
    const warnings = [
      ...responseData.uncertainties.map((value) => `Model uncertainty: ${value}`),
      ...responseData.items.length > this.config.extractionMaxCount ? ["Extraction exceeded the configured maximum and was truncated."] : [],
    ];
    if (normalized.skippedItems.length > this.config.maxSkippedItems) {
      warnings.push("Skipped source items exceeded the configured reporting limit.");
    }
    const truncated = responseData.truncated || responseData.items.length > this.config.extractionMaxCount;
    items = items.slice(0, this.config.extractionMaxCount);
    if (items.length < normalized.items.length) warnings.push("Extraction candidates were truncated to the configured maximum.");
    if (!items.length && sourceStatus === "incomplete") {
      warnings.push("Visual or OCR source processing remained incomplete after bounded recovery; no candidates were finalized.");
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
    const preferred = await preferredSourceContents(this.contentService, inputForPrepared(input), signal, { fastTextPdf: true });

    if (meaningfulSourceCharacters(preferred.contents) < 120) {
      throw new AIServiceError("AI_EXTRACTION_INCOMPLETE", {
        publicMessage: "The uploaded source did not contain enough readable educational content to generate MCQs.",
        diagnosticMessage: "MCQ generation fast-path produced less than 120 non-whitespace source characters.",
        retryable: true,
      });
    }

    // A single 20-item structured response is large (question + four options +
    // answer + optional hint/explanation + metadata) and Cloudflare/Llama may
    // validly return an empty items array when strict JSON generation becomes
    // too constrained. Generate in small source-grounded batches instead. Four
    // 5-item requests can run in parallel, are substantially faster, and each
    // response remains comfortably inside the structured-output budget.
    const generationBatchSize = 5;
    const initialBatchCount = Math.ceil(selected.count / generationBatchSize);
    const coverageSources = generationCoverageWindows(preferred.contents, initialBatchCount);

    const batchSource = (batchIndex: number, recovery = false): AIContentPart[] => {
      if (recovery && preferred.contents.length === 1 && preferred.contents[0]?.kind === "text" &&
          preferred.contents[0].sizeBytes <= 12_000) {
        return preferred.contents;
      }
      return coverageSources[batchIndex % coverageSources.length] ?? preferred.contents;
    };

    const generateBatch = async (start: number, count: number, recovery = false) => {
      const batchIndex = Math.floor(start / generationBatchSize);
      const contents = batchSource(batchIndex, recovery);
      const sourceChars = meaningfulSourceCharacters(contents);
      const instruction = [
        buildMCQGenerateInstruction({ ...selected, count }),
        `Generate ${count} question(s) from source coverage segment ${Math.min(batchIndex + 1, coverageSources.length)} of ${coverageSources.length}.`,
        "The supplied source has already been verified as readable educational material. Do not return an empty items array merely because page/section provenance is unavailable; source may be null and will be reconstructed by the application.",
        "Use distinct testable facts from this source segment. When the segment contains enough facts, return the full requested count.",
        recovery
          ? "RECOVERY PASS: the previous generation returned too few items. Produce the missing source-grounded questions now; keep the same source facts and do not repeat obvious earlier questions."
          : "",
      ].filter(Boolean).join("\n\n");

      let compactResult = await this.contentService.generateStructured({
        contents,
        responseSchema: mcqGenerationCompactProviderResponseSchema,
        trustedSystemInstruction: instruction,
        operation: "generate",
        requestedCount: count,
        maxItems: count,
        sourceWindowIndex: batchIndex,
        signal,
      });
      let result = {
        ...compactResult,
        data: expandCompactGenerationResponse(compactResult.data),
      };

      // Empty structured output from a clearly non-empty lecture is not treated
      // as proof that the lecture cannot support questions. Retry this small
      // batch once against the broader prepared source. This avoids the old
      // all-or-nothing 20-question recovery request.
      if (!result.data.items.length && sourceChars >= 250 && !recovery) {
        compactResult = await this.contentService.generateStructured({
          contents: batchSource(batchIndex, true),
          responseSchema: mcqGenerationCompactProviderResponseSchema,
          trustedSystemInstruction: [
            buildMCQGenerateInstruction({ ...selected, count }),
            `EMPTY-BATCH RECOVERY: generate ${count} source-grounded MCQ(s) from the readable lecture content.`,
            "Do not return items: [] when the source contains testable statements. The application will add provenance metadata after generation; focus on the factual MCQ fields.",
          ].join("\n\n"),
          operation: "generate",
          requestedCount: count,
          maxItems: count,
          sourceWindowIndex: batchIndex,
          signal,
        });
        result = {
          ...compactResult,
          data: expandCompactGenerationResponse(compactResult.data),
        };
      }
      return result;
    };

    let responses = await runResilientBatches({
      total: selected.count,
      batchSize: generationBatchSize,
      minimumBatchSize: 1,
      concurrency: Math.min(4, initialBatchCount),
      signal,
      run: ({ start, count }) => generateBatch(start, count, false),
    });

    let returnedBeforeRecovery = responses.reduce((total, response) => total + response.data.items.length, 0);
    if (returnedBeforeRecovery < selected.count) {
      const deficit = selected.count - returnedBeforeRecovery;
      const recovery = await runResilientBatches({
        total: deficit,
        batchSize: generationBatchSize,
        minimumBatchSize: 1,
        concurrency: Math.min(4, Math.ceil(deficit / generationBatchSize)),
        signal,
        run: ({ start, count }) => generateBatch(start, count, true),
      });
      responses = [...responses, ...recovery];
      returnedBeforeRecovery = responses.reduce((total, response) => total + response.data.items.length, 0);
    }

    const provider = responses[0]?.meta ?? preferred.providerMeta ?? { provider: "unknown", model: "unknown" };
    const normalized = responses.flatMap((response) => normalizeGeneratedItems(
      response.data,
      input,
      selected,
      this.candidateId,
    ));
    const items = applyBatchDuplicateWarnings(normalized).slice(0, selected.count);
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
      throw new AIServiceError("AI_EXTRACTION_INCOMPLETE", {
        publicMessage: "The lecture was read successfully, but Cloudflare returned no generated MCQs. Please retry the generation.",
        diagnosticMessage: `Readable MCQ generation source (${meaningfulSourceCharacters(preferred.contents)} non-whitespace characters) returned zero items after small-batch recovery.`,
        retryable: true,
      });
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
      "complete",
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
    const candidates = ("source" in input ? input.candidates : extraction!.items).map((item) =>
      withRecoveredEnhancementSource({
        ...item,
        warnings: [...item.warnings],
      }, source));
    const eligible = candidates.filter((item) =>
      item.correctAnswer !== null &&
      ((!selected.hint && !selected.explanation) ||
        (selected.hint && item.hint === null) ||
        (selected.explanation && item.explanation === null)),
    );
    // Enhancement already has the exact extracted question, options and preserved
    // answer. Re-reading the original PDF/image here is redundant and was the
    // reason scanned PDFs could extract successfully but then fail during
    // Enhance with a second vision/OCR pass. Enhancement now runs only against
    // the candidate batch plus its recovered source excerpt.
    let provider = extraction?.provider ?? { provider: "cloudflare", model: "unknown" };
    const warnings = [...(extraction?.warnings ?? [])];
    if (eligible.length > 0) {
      const responses = await runResilientBatches({
        total: eligible.length,
        batchSize: 20,
        concurrency: 4,
        signal,
        run: ({ start, count }) => {
          const batch = eligible.slice(start, start + count);
          return this.contentService.generateStructured({
            contents: textContentsFromPreparedText(enhancementContext(batch), "MCQ enhancement candidates"),
            responseSchema: createMCQEnhancementProviderResponseSchema(selected),
            trustedSystemInstruction: buildMCQEnhanceInstruction(selected),
            additionalUntrustedContext: enhancementContext(batch),
            operation: "enhance",
            maxItems: count,
            sourceWindowIndex: Math.floor(start / 20),
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
          concurrency: 4,
          signal,
          run: ({ start, count }) => this.contentService.generateStructured({
            contents: textContentsFromPreparedText(enhancementContext(missing.slice(start, start + count)), "MCQ enhancement recovery candidates"),
            responseSchema: createMCQEnhancementProviderResponseSchema(selected),
            trustedSystemInstruction: [
              buildMCQEnhanceInstruction(selected),
              "This is bounded missing-field recovery. Return only the requested candidate IDs and fill every requested field that is still missing.",
            ].join("\n\n"),
            additionalUntrustedContext: enhancementContext(missing.slice(start, start + count)),
            operation: "enhance",
            maxItems: count,
            sourceWindowIndex: Math.floor(start / 20),
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

      if (selected.explanation) {
        const afterGeneralRecovery = new Map(mergedResponse.items.map((item) => [item.candidateId, item]));
        const explanationMissing = eligible.filter((item) => {
          const enhancement = afterGeneralRecovery.get(item.candidateId);
          return item.explanation === null && !enhancement?.explanation;
        });
        if (explanationMissing.length > 0) {
          const recovery = await runResilientBatches({
            total: explanationMissing.length,
            batchSize: 10,
            concurrency: 4,
            signal,
            run: ({ start, count }) => this.contentService.generateStructured({
              contents: textContentsFromPreparedText(enhancementContext(explanationMissing.slice(start, start + count)), "MCQ explanation recovery candidates"),
              responseSchema: createMCQRequiredEnhancementProviderResponseSchema({ hint: false, explanation: true }),
              trustedSystemInstruction: [
                buildMCQEnhanceInstruction({ hint: false, explanation: true }),
                "Targeted explanation recovery: return only explanation for the listed candidate IDs.",
                "Every returned explanation must align with the preserved correctAnswer and must not be left null when the source supports a safe explanation.",
              ].join("\n\n"),
              additionalUntrustedContext: enhancementContext(explanationMissing.slice(start, start + count)),
              operation: "enhance",
              maxItems: count,
              sourceWindowIndex: Math.floor(start / 10),
              signal,
            }),
            onFailure: (batch) => {
              warnings.push(`Targeted explanation recovery ${batch.start + 1}-${batch.start + batch.count} failed; original candidates were retained.`);
            },
          });
          mergedResponse = {
            items: mergeEnhancementItems([...mergedResponse.items, ...recovery.flatMap((response) => response.data.items)]),
            uncertainties: [...mergedResponse.uncertainties, ...recovery.flatMap((response) => response.data.uncertainties)],
          };
        }
      }

      if (selected.hint) {
        const afterExplanationRecovery = new Map(mergedResponse.items.map((item) => [item.candidateId, item]));
        const hintMissing = eligible.filter((item) => {
          const enhancement = afterExplanationRecovery.get(item.candidateId);
          return item.hint === null && !enhancement?.hint;
        });
        if (hintMissing.length > 0) {
          const recovery = await runResilientBatches({
            total: hintMissing.length,
            batchSize: 10,
            concurrency: 4,
            signal,
            run: ({ start, count }) => this.contentService.generateStructured({
              contents: textContentsFromPreparedText(enhancementContext(hintMissing.slice(start, start + count)), "MCQ hint recovery candidates"),
              responseSchema: createMCQRequiredEnhancementProviderResponseSchema({ hint: true, explanation: false }),
              trustedSystemInstruction: [
                buildMCQEnhanceInstruction({ hint: true, explanation: false }),
                "Targeted hint recovery: return only hint for the listed candidate IDs.",
              ].join("\n\n"),
              additionalUntrustedContext: enhancementContext(hintMissing.slice(start, start + count)),
              operation: "enhance",
              maxItems: count,
              sourceWindowIndex: Math.floor(start / 10),
              signal,
            }),
            onFailure: (batch) => {
              warnings.push(`Targeted hint recovery ${batch.start + 1}-${batch.start + batch.count} failed; original candidates were retained.`);
            },
          });
          mergedResponse = {
            items: mergeEnhancementItems([...mergedResponse.items, ...recovery.flatMap((response) => response.data.items)]),
            uncertainties: [...mergedResponse.uncertainties, ...recovery.flatMap((response) => response.data.uncertainties)],
          };
        }
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
          reviewConfidenceThreshold: Math.min(this.config.reviewConfidenceThreshold, 0.7),
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
          if (stage2.confidence < Math.min(this.config.reviewConfidenceThreshold, 0.7)) {
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
        reviewConfidenceThreshold: Math.min(this.config.reviewConfidenceThreshold, 0.7),
      });
    });
  }
}