import type { PreparedAIInput } from "../input/contracts.js";
import type { FlashcardSourceEvidence } from "./contracts.js";
import { MAX_FLASHCARD_SOURCE_EXCERPT_LENGTH, MAX_FLASHCARD_SOURCE_SECTION_LENGTH } from "./config.js";

export interface FlashcardSourceValidationResult {
  source: FlashcardSourceEvidence | null;
  warnings: string[];
}

export function validateFlashcardSourceEvidence(
  source: FlashcardSourceEvidence | null | undefined,
  input: PreparedAIInput,
  maxExcerptLength = MAX_FLASHCARD_SOURCE_EXCERPT_LENGTH,
): FlashcardSourceValidationResult {
  if (!source) {
    return { source: null, warnings: ["Source evidence was not provided."] };
  }

  const inputKind = input.input.kind;
  if (source.inputType !== inputKind) {
    return {
      source: null,
      warnings: ["Source evidence input type did not match the supplied source."],
    };
  }

  const imageCount = input.input.kind === "image" ? input.input.images.length : undefined;
  const normalized: FlashcardSourceEvidence = {
    inputType: source.inputType,
    ...(source.page === undefined ? {} : { page: source.page }),
    ...(source.imageIndex === undefined ? {} : { imageIndex: source.imageIndex }),
    ...(source.section ? { section: source.section.slice(0, MAX_FLASHCARD_SOURCE_SECTION_LENGTH) } : {}),
    ...(source.label ? { label: source.label.slice(0, 200) } : {}),
    ...(source.supportingExcerpt !== undefined && source.supportingExcerpt !== null
      ? { supportingExcerpt: source.supportingExcerpt.slice(0, maxExcerptLength) }
      : {}),
  };
  const warnings: string[] = [];

  if (source.inputType === "pdf") {
    if (source.page === undefined || !Number.isInteger(source.page) || source.page <= 0) {
      warnings.push("PDF source evidence did not contain a valid positive page.");
      delete normalized.page;
    }
  } else if (source.inputType === "image") {
    if (
      source.imageIndex === undefined ||
      !Number.isInteger(source.imageIndex) ||
      source.imageIndex < 0 ||
      imageCount === undefined ||
      source.imageIndex >= imageCount
    ) {
      warnings.push("Image source evidence contained an invalid image index.");
      delete normalized.imageIndex;
    }
  } else if (!source.section) {
    warnings.push("Text source evidence did not contain a section.");
  }
  if (source.supportingExcerpt && source.supportingExcerpt.length > maxExcerptLength) {
    warnings.push("Source excerpt was bounded to the configured maximum length.");
  }

  return { source: normalized, warnings };
}