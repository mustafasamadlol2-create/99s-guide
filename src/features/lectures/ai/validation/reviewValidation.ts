import type {
  AIMCQCandidate,
  AIFlashcardCandidate,
  LocalValidation,
} from "../types/aiPreview";

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function validateMCQCandidate(
  candidate: Pick<AIMCQCandidate, "question" | "optionA" | "optionB" | "optionC" | "optionD" | "correctAnswer" | "category" | "difficulty">
    & Partial<Pick<AIMCQCandidate, "importReady" | "needsReview" | "warnings">>,
): LocalValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const options = [candidate.optionA, candidate.optionB, candidate.optionC, candidate.optionD];
  if (!candidate.question.trim()) errors.push("Question is required.");
  options.forEach((option, index) => {
    if (!option.trim()) errors.push(`Option ${String.fromCharCode(65 + index)} is required.`);
  });
  if (!candidate.correctAnswer) errors.push("Choose the correct answer.");
  if (!candidate.category) errors.push("Choose an MCQ category.");
  if (!candidate.difficulty) errors.push("Choose a difficulty.");
  const normalizedOptions = options.map(normalized).filter(Boolean);
  if (new Set(normalizedOptions).size !== normalizedOptions.length) {
    errors.push("Options must not be duplicates.");
  }
  warnings.push(...(candidate.warnings ?? []));
  return {
    ready: errors.length === 0 &&
      candidate.importReady !== false &&
      candidate.needsReview !== true &&
      warnings.length === 0,
    errors,
    warnings,
  };
}

export function validateFlashcardCandidate(
  candidate: Pick<AIFlashcardCandidate, "clinicalConcept" | "explanation">
    & Partial<Pick<AIFlashcardCandidate, "importReady" | "needsReview" | "warnings">>,
): LocalValidation {
  const errors: string[] = [];
  if (!candidate.clinicalConcept.trim()) errors.push("Clinical concept is required.");
  if (!candidate.explanation?.trim()) errors.push("Explanation is required.");
  const warnings = [...(candidate.warnings ?? [])];
  return {
    ready: errors.length === 0 &&
      candidate.importReady !== false &&
      candidate.needsReview !== true &&
      warnings.length === 0,
    errors,
    warnings,
  };
}

export function isArabicText(value: string): boolean {
  return /[\u0600-\u06ff]/.test(value);
}