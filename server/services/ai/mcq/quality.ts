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

export function isMeaninglessMCQQuestion(value: string): boolean {
  const normalized = normalizeForComparison(value);
  return normalized.length < 8 ||
    /^(?:question|question\s*\d+|answer|options?|instructions?|select one)$/iu.test(normalized) ||
    /^(?:ignore|follow)\s+(?:previous|these)\s+instructions/iu.test(normalized) ||
    /(?:\.\.\.|…)$/.test(value.trim());
}

function nearDuplicateQuestion(left: string, right: string): boolean {
  const a = normalizeForComparison(left);
  const b = normalizeForComparison(right);
  if (a === b || a.length < 18 || b.length < 18) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const aWords = new Set(a.split(/\W+/u).filter(Boolean));
  const bWords = new Set(b.split(/\W+/u).filter(Boolean));
  const intersection = [...aWords].filter((word) => bWords.has(word)).length;
  return intersection / Math.max(aWords.size, bWords.size) >= 0.85;
}

export function applyBatchDuplicateWarnings(items: AIMCQCandidate[]): AIMCQCandidate[] {
  const groups = new Map<string, AIMCQCandidate[]>();
  for (const item of items) {
    const key = normalizeForComparison(item.question);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return items.map((item, index) => {
    const duplicate = (groups.get(normalizeForComparison(item.question))?.length ?? 0) > 1;
    const nearDuplicate = items.some((other, otherIndex) =>
      otherIndex !== index && nearDuplicateQuestion(item.question, other.question));
    const warnings = [...item.warnings];
    if (isMeaninglessMCQQuestion(item.question)) warnings.push("The question stem is empty, truncated, or not a meaningful question.");
    if (nearDuplicate) warnings.push("The question is near-duplicate of another item in this result batch.");
    if (!duplicate && !nearDuplicate && !isMeaninglessMCQQuestion(item.question)) return item;
    return {
      ...item,
      needsReview: true,
      warnings: [...new Set([
        ...warnings,
        ...(duplicate ? ["Question duplicates another item in this result batch."] : []),
      ])],
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