import type { MCQAnswer } from "../contracts.js";
import type {
  AIMCQCandidate,
  MCQAIEngineInput,
  MCQDifficulty,
  MCQExtractOptions,
  MCQSourceEvidence,
  SkippedMCQSourceItem,
} from "./contracts.js";
import { MCQ_DIFFICULTIES } from "./contracts.js";
import { MAX_UNCERTAINTIES } from "./config.js";
import type {
  MCQExtractionProviderResponse,
  MCQGenerationProviderResponse,
} from "./schemas.js";
import { applyQualityWarnings } from "./quality.js";
import { validateMCQSourceEvidence } from "./sourceValidation.js";
import type { PreparedAIInput } from "../input/contracts.js";

export function normalizeDifficulty(value: string | null | undefined): MCQDifficulty | null {
  if (!value) return null;
  const match = MCQ_DIFFICULTIES.find((difficulty) => difficulty.toLowerCase() === value.trim().toLowerCase());
  return match ?? null;
}

function uncertaintiesToWarnings(uncertainties: string[]): string[] {
  return uncertainties.slice(0, MAX_UNCERTAINTIES).map((uncertainty) => `Model uncertainty: ${uncertainty}`);
}

function sourceWarnings(
  source: MCQSourceEvidence | null | undefined,
  input: PreparedAIInput | MCQAIEngineInput,
): { source: MCQSourceEvidence | null; warnings: string[] } {
  return validateMCQSourceEvidence(source, input);
}

export function normalizeExtractedItems(
  response: MCQExtractionProviderResponse,
  input: PreparedAIInput | MCQAIEngineInput,
  candidateId: () => string,
  metadata: MCQExtractOptions = { category: "AI_GENERATED", difficulty: "Medium" },
): { items: AIMCQCandidate[]; skippedItems: SkippedMCQSourceItem[] } {
  const skippedItems: SkippedMCQSourceItem[] = response.skippedItems.map((item) => {
    const validated = sourceWarnings(item.source, input);
    return {
      reason: item.reason,
      source: validated.source,
      ...(item.summary ? { summary: item.summary } : {}),
    };
  });
  const items: AIMCQCandidate[] = [];
  for (const item of response.items) {
    const validatedSource = sourceWarnings(item.source, input);
    const warnings = [
      ...uncertaintiesToWarnings(item.uncertainties),
      ...validatedSource.warnings,
    ];
    if (item.options.length !== 4) {
      skippedItems.push({
        reason: "unsupported_option_count",
        source: validatedSource.source,
        summary: `Source item contained ${item.options.length} options; exactly four are supported.`,
      });
      continue;
    }
    if (!item.question?.trim()) {
      skippedItems.push({
        reason: "missing_question",
        source: validatedSource.source,
        summary: "Source item did not contain a readable question.",
      });
      continue;
    }
    if (!item.correctAnswer) warnings.push("The source did not explicitly establish a correct answer.");
    const difficulty = metadata.difficulty;
    const normalized = applyQualityWarnings({
      candidateId: candidateId(),
      question: item.question,
      optionA: item.options[0]!,
      optionB: item.options[1]!,
      optionC: item.options[2]!,
      optionD: item.options[3]!,
      correctAnswer: item.correctAnswer as MCQAnswer | null,
      hint: item.hint,
      explanation: item.explanation,
      difficulty,
      category: metadata.category,
      provenance: "extracted",
      source: validatedSource.source,
      confidence: item.confidence,
      importReady: false,
      needsReview: warnings.length > 0,
      requiresHumanApproval: true,
      warnings,
    }, {
      requireAnswer: false,
      requestedHint: false,
      requestedExplanation: false,
    });
    items.push(normalized);
  }
  return { items, skippedItems };
}

export function normalizeGeneratedItems(
  response: MCQGenerationProviderResponse,
  input: PreparedAIInput,
  options: {
    includeHints: boolean;
    includeExplanations: boolean;
    difficulty?: string | null;
  },
  candidateId: () => string,
): AIMCQCandidate[] {
  return response.items.map((item) => {
    const validatedSource = sourceWarnings(item.source, input);
    const warnings = [
      ...uncertaintiesToWarnings(item.uncertainties),
      ...validatedSource.warnings,
    ];
    const difficulty = normalizeDifficulty(item.difficulty);
    if (item.difficulty && !normalizeDifficulty(item.difficulty)) {
      warnings.push("Difficulty was not an accepted application value and was omitted.");
    }
    if (!difficulty) warnings.push("The model must classify every generated question as Easy, Medium, or Hard.");
    const normalized = {
      candidateId: candidateId(),
      question: item.question,
      optionA: item.optionA,
      optionB: item.optionB,
      optionC: item.optionC,
      optionD: item.optionD,
      correctAnswer: item.correctAnswer,
      hint: options.includeHints ? item.hint : null,
      explanation: options.includeExplanations ? item.explanation : null,
      difficulty,
      category: "AI_GENERATED" as const,
      provenance: "generated" as const,
      source: validatedSource.source,
      confidence: item.confidence,
      importReady: false,
      needsReview: warnings.length > 0,
      requiresHumanApproval: true as const,
      warnings,
    };
    return applyQualityWarnings(normalized, {
      requireAnswer: true,
      requestedHint: options.includeHints,
      requestedExplanation: options.includeExplanations,
    });
  });
}