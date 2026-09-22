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
  const imageCount = input.input.kind === "image" ? input.input.images.length : undefined;
  let effectiveSource: FlashcardSourceEvidence = source;
  if (source.inputType !== inputKind) {
    if (inputKind === "pdf" && source.inputType === "text") {
      effectiveSource = { ...source, inputType: "pdf", imageIndex: undefined };
    } else if (inputKind === "image" && source.inputType === "text" && imageCount === 1) {
      effectiveSource = { ...source, inputType: "image", imageIndex: 0, page: undefined };
    } else {
      return {
        source: null,
        warnings: ["Source evidence input type did not match the supplied source."],
      };
    }
  }

  const normalized: FlashcardSourceEvidence = {
    inputType: effectiveSource.inputType,
    ...(effectiveSource.page === undefined ? {} : { page: effectiveSource.page }),
    ...(effectiveSource.imageIndex === undefined ? {} : { imageIndex: effectiveSource.imageIndex }),
    ...(effectiveSource.section ? { section: effectiveSource.section.slice(0, MAX_FLASHCARD_SOURCE_SECTION_LENGTH) } : {}),
    ...(effectiveSource.label ? { label: effectiveSource.label.slice(0, 200) } : {}),
    ...(effectiveSource.supportingExcerpt !== undefined && effectiveSource.supportingExcerpt !== null
      ? { supportingExcerpt: effectiveSource.supportingExcerpt.slice(0, maxExcerptLength) }
      : {}),
  };
  const warnings: string[] = [];

  if (effectiveSource.inputType === "pdf") {
    if (effectiveSource.page !== undefined && (!Number.isInteger(effectiveSource.page) || effectiveSource.page <= 0)) {
      warnings.push("PDF source evidence did not contain a valid positive page.");
      delete normalized.page;
    }
    if (effectiveSource.page === undefined && !effectiveSource.section && !effectiveSource.supportingExcerpt) {
      warnings.push("PDF source evidence did not contain a page or excerpt.");
    }
  } else if (effectiveSource.inputType === "image") {
    if (
      effectiveSource.imageIndex === undefined ||
      !Number.isInteger(effectiveSource.imageIndex) ||
      effectiveSource.imageIndex < 0 ||
      imageCount === undefined ||
      effectiveSource.imageIndex >= imageCount
    ) {
      warnings.push("Image source evidence contained an invalid image index.");
      delete normalized.imageIndex;
    }
  } else if (!effectiveSource.section) {
    warnings.push("Text source evidence did not contain a section.");
  }
  if (effectiveSource.supportingExcerpt && effectiveSource.supportingExcerpt.length > maxExcerptLength) {
    warnings.push("Source excerpt was bounded to the configured maximum length.");
  }

  return { source: normalized, warnings };
}