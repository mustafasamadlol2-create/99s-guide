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

function fallbackSourceEvidence(
  input: PreparedAIInput,
  summary: { front?: string | null; back?: string | null; section?: string | null },
): FlashcardSourceEvidence | null {
  const section = summary.section?.trim() || (summary.front?.trim() ? summary.front.trim().slice(0, 80) : "Recovered source evidence");
  const excerpt = [summary.front?.trim() ?? "", summary.back?.trim() ?? ""].filter(Boolean).join("\n").slice(0, 300);
  if (!section && !excerpt) return null;
  if (input.input.kind === "pdf") return { inputType: "pdf", section, supportingExcerpt: excerpt || undefined };
  if (input.input.kind === "image") return { inputType: "image", imageIndex: 0, supportingExcerpt: excerpt || undefined };
  return { inputType: "text", section, supportingExcerpt: excerpt || undefined };
}

function validatedOrFallbackSource(
  source: FlashcardSourceEvidence | null | undefined,
  input: PreparedAIInput,
  summary: { front?: string | null; back?: string | null; section?: string | null } = {},
): { source: FlashcardSourceEvidence | null; warnings: string[] } {
  const validated = validateFlashcardSourceEvidence(source, input);
  if (validated.source) return validated;
  const fallback = fallbackSourceEvidence(input, summary);
  if (!fallback) return validated;
  return {
    source: fallback,
    warnings: validated.warnings.filter((warning) => ![
      "Source evidence was not provided.",
      "Source evidence input type did not match the supplied source.",
      "Text source evidence did not contain a section.",
      "PDF source evidence did not contain a page or excerpt.",
      "Image source evidence contained an invalid image index.",
    ].includes(warning)),
  };
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
    const validated = validatedOrFallbackSource(item.source, input, { section: item.summary ?? undefined });
    warnings.push(...validated.warnings);
    return {
      reason: item.reason,
      source: validated.source,
      ...(item.summary ? { summary: item.summary } : {}),
    };
  });
  const items: AIFlashcardCandidate[] = [];

  for (const item of response.items) {
    const validatedSource = validatedOrFallbackSource(item.source, input, {
      front: item.clinicalConcept,
      back: item.explanation,
    });
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
    const validatedSource = validatedOrFallbackSource(item.source, input, {
      front: item.clinicalConcept,
      back: item.explanation,
    });
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
