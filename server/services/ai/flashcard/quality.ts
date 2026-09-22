import type { AIFlashcardCandidate } from "./contracts.js";
import { FLASHCARD_REVIEW_CONFIDENCE_THRESHOLD } from "./config.js";

export function normalizeFlashcardForComparison(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function isMeaninglessFlashcardConcept(value: string): boolean {
  const normalized = normalizeFlashcardForComparison(value);
  return normalized.length < 3 || /^(?:[?!.:-]+|n\/?a|question|concept)$/iu.test(normalized);
}

export function hasNearIdenticalFrontBack(candidate: Pick<AIFlashcardCandidate, "clinicalConcept" | "explanation">): boolean {
  if (!candidate.explanation) return false;
  const front = normalizeFlashcardForComparison(candidate.clinicalConcept);
  const back = normalizeFlashcardForComparison(candidate.explanation);
  return front.length > 0 && front === back;
}

function nearDuplicateFront(left: string, right: string): boolean {
  const a = normalizeFlashcardForComparison(left);
  const b = normalizeFlashcardForComparison(right);
  if (a === b || a.length < 14 || b.length < 14) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const aWords = new Set(a.split(/\W+/u).filter(Boolean));
  const bWords = new Set(b.split(/\W+/u).filter(Boolean));
  const intersection = [...aWords].filter((word) => bWords.has(word)).length;
  return intersection / Math.max(aWords.size, bWords.size) >= 0.85;
}

function isLowQualityFront(value: string): boolean {
  const normalized = normalizeFlashcardForComparison(value);
  return /^(?:question|answer|front|back|concept|instructions?)$/iu.test(normalized) ||
    /^(?:ignore|follow)\s+(?:previous|these)\s+instructions/iu.test(normalized) ||
    /(?:\.\.\.|…)$/.test(value.trim());
}

export function applyFlashcardBatchDuplicateWarnings(items: AIFlashcardCandidate[]): AIFlashcardCandidate[] {
  const frontGroups = new Map<string, AIFlashcardCandidate[]>();
  const pairGroups = new Map<string, AIFlashcardCandidate[]>();
  for (const item of items) {
    const frontKey = normalizeFlashcardForComparison(item.clinicalConcept);
    const pairKey = `${frontKey}\u0000${normalizeFlashcardForComparison(item.explanation ?? "")}`;
    frontGroups.set(frontKey, [...(frontGroups.get(frontKey) ?? []), item]);
    pairGroups.set(pairKey, [...(pairGroups.get(pairKey) ?? []), item]);
  }

  return items.map((item, index) => {
    const frontKey = normalizeFlashcardForComparison(item.clinicalConcept);
    const pairKey = `${frontKey}\u0000${normalizeFlashcardForComparison(item.explanation ?? "")}`;
    const warnings = [...item.warnings];
    if ((frontGroups.get(frontKey)?.length ?? 0) > 1) {
      warnings.push("Flashcard front duplicates another item in this result batch.");
    }
    if (item.explanation && (pairGroups.get(pairKey)?.length ?? 0) > 1) {
      warnings.push("Flashcard front and back duplicate another item in this result batch.");
    }
    if (isLowQualityFront(item.clinicalConcept)) {
      warnings.push("The Flashcard front is empty, truncated, or not a meaningful concept.");
    }
    if (items.some((other, otherIndex) =>
      otherIndex !== index && nearDuplicateFront(item.clinicalConcept, other.clinicalConcept))) {
      warnings.push("The Flashcard front is near-duplicate of another item in this result batch.");
    }
    return {
      ...item,
      needsReview: item.needsReview || warnings.length > item.warnings.length,
      warnings: [...new Set(warnings)],
    };
  });
}

export function applyFlashcardQualityWarnings(
  candidate: AIFlashcardCandidate,
  options: { requireExplanation: boolean; reviewConfidenceThreshold?: number },
): AIFlashcardCandidate {
  const warnings = [...candidate.warnings];
  const add = (warning: string) => {
    if (!warnings.includes(warning)) warnings.push(warning);
  };
  if (isMeaninglessFlashcardConcept(candidate.clinicalConcept)) {
    add("The Flashcard concept is empty or not meaningful.");
  }
  if (options.requireExplanation && !candidate.explanation) {
    add("The Flashcard explanation is missing.");
  }
  if (hasNearIdenticalFrontBack(candidate)) {
    add("The Flashcard explanation repeats the concept too closely.");
  }
  if (candidate.confidence < (options.reviewConfidenceThreshold ?? FLASHCARD_REVIEW_CONFIDENCE_THRESHOLD)) {
    add("Confidence is below the review threshold.");
  }
  const importReady = Boolean(candidate.clinicalConcept.trim() && candidate.explanation?.trim());
  return {
    ...candidate,
    importReady,
    needsReview: candidate.needsReview || warnings.length > 0,
    warnings,
  };
}

export function summarizeFlashcardCounts(items: AIFlashcardCandidate[], skippedCount: number) {
  return {
    returnedCount: items.length,
    readyCount: items.filter((item) => item.importReady).length,
    reviewCount: items.filter((item) => item.needsReview).length,
    skippedCount,
  };
}