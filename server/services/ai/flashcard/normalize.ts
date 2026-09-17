import type { PreparedAIInput } from "../input/contracts.js";
import type {
  AIFlashcardCandidate,
  FlashcardSourceEvidence,
  SkippedFlashcardSourceItem,
} from "./contracts.js";
import { MAX_FLASHCARD_UNCERTAINTIES } from "./config.js";
import type {
  FlashcardExtractionProviderResponse,
  FlashcardGenerationProviderResponse,
} from "./schemas.js";
import { applyFlashcardQualityWarnings } from "./quality.js";
import { validateFlashcardSourceEvidence } from "./sourceValidation.js";

function uncertaintiesToWarnings(uncertainties: string[]): string[] {
  return uncertainties
    .slice(0, MAX_FLASHCARD_UNCERTAINTIES)
    .map((uncertainty) => `Model uncertainty: ${uncertainty}`);
}

export function normalizeExtractedFlashcards(
  response: FlashcardExtractionProviderResponse,
  input: PreparedAIInput,
  candidateId: () => string,
): {
  items: AIFlashcardCandidate[];
  skippedItems: SkippedFlashcardSourceItem[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const skippedItems = response.skippedItems.map((item) => {
    const validated = validateFlashcardSourceEvidence(item.source, input);
    warnings.push(...validated.warnings);
    return {
      reason: item.reason,
      source: validated.source,
      ...(item.summary ? { summary: item.summary } : {}),
    };
  });
  const items: AIFlashcardCandidate[] = [];

  for (const item of response.items) {
    const validatedSource = validateFlashcardSourceEvidence(item.source, input);
    const candidateWarnings = [
      ...uncertaintiesToWarnings(item.uncertainties),
      ...validatedSource.warnings,
    ];
    if (!item.clinicalConcept?.trim()) {
      skippedItems.push({
        reason: "missing_front",
        source: validatedSource.source,
        summary: "Source item did not contain a reliably identifiable Flashcard front.",
      });
      continue;
    }
    if (!item.explanation) {
      candidateWarnings.push("The extracted Flashcard has no explicit explanation/back.");
    }
    items.push(applyFlashcardQualityWarnings({
      candidateId: candidateId(),
      clinicalConcept: item.clinicalConcept,
      explanation: item.explanation,
      provenance: "extracted",
      source: validatedSource.source,
      confidence: item.confidence,
      importReady: false,
      needsReview: candidateWarnings.length > 0,
      requiresHumanApproval: true,
      warnings: candidateWarnings,
    }, { requireExplanation: false }));
  }

  return { items, skippedItems, warnings };
}

export function normalizeGeneratedFlashcards(
  response: FlashcardGenerationProviderResponse,
  input: PreparedAIInput,
  candidateId: () => string,
): AIFlashcardCandidate[] {
  return response.items.map((item) => {
    const validatedSource = validateFlashcardSourceEvidence(item.source, input);
    return applyFlashcardQualityWarnings({
      candidateId: candidateId(),
      clinicalConcept: item.clinicalConcept,
      explanation: item.explanation,
      provenance: "generated",
      source: validatedSource.source,
      confidence: item.confidence,
      importReady: false,
      needsReview: validatedSource.warnings.length > 0 || item.uncertainties.length > 0,
      requiresHumanApproval: true,
      warnings: [
        ...uncertaintiesToWarnings(item.uncertainties),
        ...validatedSource.warnings,
      ],
    }, { requireExplanation: true });
  });
}