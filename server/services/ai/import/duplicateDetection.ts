import type { ExistingDuplicateRecord, ImportDecision } from "./contracts.js";
import { normalizeDuplicateText, previewText } from "./normalize.js";

export const NEAR_DUPLICATE_THRESHOLD = 0.92;
export const NEAR_DUPLICATE_MIN_LENGTH = 20;

function bigrams(value: string): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }
  return result;
}

function diceSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  let intersection = 0;
  for (const gram of leftBigrams) if (rightBigrams.has(gram)) intersection += 1;
  return (2 * intersection) / (leftBigrams.size + rightBigrams.size);
}

export function nearDuplicateSimilarity(left: string, right: string): number | null {
  const normalizedLeft = normalizeDuplicateText(left);
  const normalizedRight = normalizeDuplicateText(right);
  if (
    normalizedLeft.length < NEAR_DUPLICATE_MIN_LENGTH ||
    normalizedRight.length < NEAR_DUPLICATE_MIN_LENGTH
  ) return null;
  return diceSimilarity(normalizedLeft, normalizedRight);
}

interface CandidateLike {
  clientKey: string;
  key: string;
  preview: string;
}

function matchCandidate(
  candidate: CandidateLike,
  priorBatch: CandidateLike[],
  existing: ExistingDuplicateRecord[],
): Omit<ImportDecision, "clientKey"> {
  const exactBatch = priorBatch.find((item) => item.key === candidate.key);
  if (exactBatch) {
    return { status: "exact_duplicate", duplicateScope: "batch", matchedPreview: exactBatch.preview };
  }
  const exactExisting = existing.find((item) => item.key === candidate.key);
  if (exactExisting) {
    return { status: "exact_duplicate", duplicateScope: "existing", matchedPreview: exactExisting.preview };
  }

  let best: { scope: "batch" | "existing"; similarity: number; preview: string } | null = null;
  for (const item of priorBatch) {
    const similarity = nearDuplicateSimilarity(candidate.key, item.key);
    if (similarity !== null && similarity >= NEAR_DUPLICATE_THRESHOLD && (!best || similarity > best.similarity)) {
      best = { scope: "batch", similarity, preview: item.preview };
    }
  }
  for (const item of existing) {
    const similarity = nearDuplicateSimilarity(candidate.key, item.key);
    if (similarity !== null && similarity >= NEAR_DUPLICATE_THRESHOLD && (!best || similarity > best.similarity)) {
      best = { scope: "existing", similarity, preview: item.preview };
    }
  }
  if (best) {
    return {
      status: "possible_duplicate",
      duplicateScope: best.scope,
      similarity: Number(best.similarity.toFixed(4)),
      matchedPreview: best.preview,
    };
  }
  return { status: "new" };
}

export function analyzeDuplicates(
  candidates: CandidateLike[],
  existing: ExistingDuplicateRecord[],
): ImportDecision[] {
  const priorBatch: CandidateLike[] = [];
  return candidates.map((candidate) => {
    const match = matchCandidate(candidate, priorBatch, existing);
    priorBatch.push(candidate);
    return { clientKey: candidate.clientKey, ...match };
  });
}

export function summarizeDecisions(decisions: ImportDecision[]) {
  return {
    submittedCount: decisions.length,
    newCount: decisions.filter((item) => item.status === "new").length,
    exactDuplicateCount: decisions.filter((item) => item.status === "exact_duplicate").length,
    possibleDuplicateCount: decisions.filter((item) => item.status === "possible_duplicate").length,
  };
}

export function mcqCandidateKey(question: string): string {
  return normalizeDuplicateText(question);
}

export function flashcardCandidateKey(clinicalConcept: string): string {
  return normalizeDuplicateText(clinicalConcept);
}

export function duplicateRecord(id: string, keyText: string): ExistingDuplicateRecord {
  return { id, key: normalizeDuplicateText(keyText), preview: previewText(keyText) };
}