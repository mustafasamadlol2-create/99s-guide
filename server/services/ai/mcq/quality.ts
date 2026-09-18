import type { MCQAnswer } from "../contracts.js";
import type { AIMCQCandidate } from "./contracts.js";
import { MCQ_REVIEW_CONFIDENCE_THRESHOLD } from "./config.js";

export function normalizeForComparison(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function hasDuplicateOptions(candidate: Pick<AIMCQCandidate, "optionA" | "optionB" | "optionC" | "optionD">): boolean {
  const options = [candidate.optionA, candidate.optionB, candidate.optionC, candidate.optionD]
    .map(normalizeForComparison);
  return new Set(options).size !== options.length;
}

export function hasHintAnswerLeak(
  hint: string | null,
  correctAnswer: MCQAnswer | null,
  correctOption: string | null,
): boolean {
  if (!hint || !correctAnswer) return false;
  const normalizedHint = normalizeForComparison(hint);
  if (
    new RegExp(`\\b(?:answer\\s+is|choose|select|option)\\s*${correctAnswer.toLowerCase()}\\b`, "i")
      .test(normalizedHint)
  ) {
    return true;
  }
  if (!correctOption) return false;
  const normalizedOption = normalizeForComparison(correctOption);
  return normalizedOption.length >= 12 && normalizedHint.includes(normalizedOption);
}

export function applyBatchDuplicateWarnings(items: AIMCQCandidate[]): AIMCQCandidate[] {
  const groups = new Map<string, AIMCQCandidate[]>();
  for (const item of items) {
    const key = normalizeForComparison(item.question);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return items.map((item) => {
    const duplicate = (groups.get(normalizeForComparison(item.question))?.length ?? 0) > 1;
    if (!duplicate) return item;
    return {
      ...item,
      needsReview: true,
      warnings: [...new Set([...item.warnings, "Question duplicates another item in this result batch."])],
    };
  });
}

export function applyQualityWarnings(
  candidate: AIMCQCandidate,
  options: {
    requireAnswer: boolean;
    requestedHint: boolean;
    requestedExplanation: boolean;
    reviewConfidenceThreshold?: number;
  },
): AIMCQCandidate {
  const warnings = [...candidate.warnings];
  const add = (warning: string) => {
    if (!warnings.includes(warning)) warnings.push(warning);
  };
  if (hasDuplicateOptions(candidate)) add("Two or more answer options are identical.");
  if (options.requireAnswer && !candidate.correctAnswer) add("The correct answer is missing.");
  if (options.requestedHint && !candidate.hint) add("The requested hint is missing.");
  if (options.requestedExplanation && !candidate.explanation) add("The requested explanation is missing.");
  const correctOption = candidate.correctAnswer
    ? candidate[`option${candidate.correctAnswer}` as "optionA" | "optionB" | "optionC" | "optionD"]
    : null;
  if (hasHintAnswerLeak(candidate.hint, candidate.correctAnswer, correctOption)) {
    add("The hint appears to reveal the correct answer.");
  }
  if (candidate.confidence < (options.reviewConfidenceThreshold ?? MCQ_REVIEW_CONFIDENCE_THRESHOLD)) {
    add("Confidence is below the review threshold.");
  }
  const importReady = Boolean(
    candidate.question.trim() &&
    candidate.optionA.trim() &&
    candidate.optionB.trim() &&
    candidate.optionC.trim() &&
    candidate.optionD.trim() &&
    candidate.correctAnswer &&
    candidate.category &&
    candidate.difficulty,
  );
  return {
    ...candidate,
    importReady,
    needsReview: candidate.needsReview || warnings.length > 0,
    warnings,
  };
}

export function summarizeCounts(items: AIMCQCandidate[], skippedCount: number) {
  return {
    returnedCount: items.length,
    readyCount: items.filter((item) => item.importReady).length,
    reviewCount: items.filter((item) => item.needsReview).length,
    skippedCount,
  };
}