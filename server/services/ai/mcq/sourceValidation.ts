import type { PreparedAIInput } from "../input/contracts.js";
import type { MCQSourceEvidence } from "./contracts.js";
import { MAX_SOURCE_EXCERPT_LENGTH, MAX_SOURCE_SECTION_LENGTH } from "./config.js";

export interface SourceValidationResult {
  source: MCQSourceEvidence | null;
  warnings: string[];
}

export function validateMCQSourceEvidence(
  source: MCQSourceEvidence | null | undefined,
  input: PreparedAIInput | { inputKind: "pdf" | "image" | "text"; imageCount?: number },
  maxExcerptLength = MAX_SOURCE_EXCERPT_LENGTH,
): SourceValidationResult {
  if (!source) {
    return {
      source: null,
      warnings: ["Source evidence was not provided."],
    };
  }

  const inputKind = "input" in input ? input.input.kind : input.inputKind;
  const imageCount = "input" in input
    ? input.input.kind === "image" ? input.input.images.length : undefined
    : input.imageCount;
  if (source.inputType !== inputKind) {
    return {
      source: null,
      warnings: ["Source evidence input type did not match the supplied source."],
    };
  }

  const normalized: MCQSourceEvidence = {
    inputType: source.inputType,
    ...(source.page === undefined ? {} : { page: source.page }),
    ...(source.imageIndex === undefined ? {} : { imageIndex: source.imageIndex }),
    ...(source.section ? { section: source.section.slice(0, MAX_SOURCE_SECTION_LENGTH) } : {}),
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