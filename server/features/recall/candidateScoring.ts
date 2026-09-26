import type {
  RecallCandidate,
  RecallCandidateItem,
  RecallCandidateItemState,
  RecallMemoryEvidence,
  RecallMemoryOutcome,
  RecallStudiedLectureEvidence,
} from "./candidateTypes.js";
import type { RecallItemType } from "./constants.js";
import {
  RECALL_CANDIDATE_DAY_MS,
  RECALL_CANDIDATE_HOUR_MS,
  RECALL_CANDIDATE_ITEM_TYPE_ORDER,
  RECALL_CANDIDATE_LIMITS,
  RECALL_CANDIDATE_VERSION,
  RECALL_CANDIDATE_WEIGHTS,
} from "./candidateWeights.js";
import {
  isPositiveRecallMemoryOutcome,
  isWeaknessRecallMemoryOutcome,
  normalizeRecallMemoryOutcome,
} from "./sourceEvidence.js";

export interface ScoreRecallCandidateInput {
  item: RecallCandidateItem;
  lecture: RecallStudiedLectureEvidence;
  state?: RecallCandidateItemState;
  history: readonly RecallMemoryEvidence[];
  asOf: Date;
}

export function calculateRecallWeaknessScore(
  history: readonly RecallMemoryEvidence[],
  asOf: Date,
): number {
  const recentHistory = history
    .filter(
      (evidence) =>
        Number.isFinite(evidence.occurredAt.getTime()) &&
        evidence.occurredAt.getTime() <= asOf.getTime(),
    )
    .sort(compareEvidenceNewestFirst)
    .slice(0, RECALL_CANDIDATE_LIMITS.maxMeaningfulHistory)
    .sort(compareEvidenceOldestFirst);

  let score = 0;
  for (const evidence of recentHistory) {
    if (isWeaknessRecallMemoryOutcome(evidence.outcome)) {
      score = Math.min(75, score + 25);
    } else if (isPositiveRecallMemoryOutcome(
      evidence.itemType,
      evidence.outcome,
    )) {
      score = Math.max(0, score - 15);
    }
  }
  return clampInteger(score, 0, 100);
}

export function calculateForgettingUrgencyScore(
  asOf: Date,
  evidenceAt: Date | null | undefined,
): number {
  if (!evidenceAt || !Number.isFinite(evidenceAt.getTime())) return 100;
  const elapsedMs = Math.max(0, asOf.getTime() - evidenceAt.getTime());
  const elapsedDays = elapsedMs / RECALL_CANDIDATE_DAY_MS;
  if (elapsedDays < 1) return 10;
  if (elapsedDays < 3) return 25;
  if (elapsedDays < 7) return 45;
  if (elapsedDays < 14) return 65;
  if (elapsedDays < 30) return 80;
  return 100;
}

export function calculateRecencyPreferenceScore(
  asOf: Date,
  lastPresentedAt: Date | null | undefined,
): number {
  if (!lastPresentedAt || !Number.isFinite(lastPresentedAt.getTime())) {
    return 100;
  }
  const elapsedMs = Math.max(0, asOf.getTime() - lastPresentedAt.getTime());
  const elapsedHours = elapsedMs / RECALL_CANDIDATE_HOUR_MS;
  if (elapsedHours < 1) return 0;
  if (elapsedHours < 6) return 15;
  if (elapsedHours < 24) return 35;
  if (elapsedHours < 72) return 60;
  if (elapsedHours < 168) return 80;
  return 100;
}

export function findLastPositiveMemoryEvidenceAt(
  itemType: RecallItemType,
  history: readonly RecallMemoryEvidence[],
  state: RecallCandidateItemState | undefined,
  asOf: Date,
): Date | undefined {
  const positiveHistory = history
    .filter(
      (evidence) =>
        evidence.itemType === itemType &&
        evidence.occurredAt.getTime() <= asOf.getTime() &&
        isPositiveRecallMemoryOutcome(itemType, evidence.outcome),
    )
    .sort(compareEvidenceNewestFirst)[0]?.occurredAt;

  const stateOutcome =
    state?.lastOutcome === null || state?.lastOutcome === undefined
      ? null
      : normalizeRecallMemoryOutcome(itemType, state.lastOutcome);
  const positiveStateAt =
    state?.lastAnsweredAt &&
    state.lastAnsweredAt.getTime() <= asOf.getTime() &&
    stateOutcome &&
    isPositiveRecallMemoryOutcome(itemType, stateOutcome)
      ? state.lastAnsweredAt
      : undefined;

  if (!positiveHistory) return positiveStateAt;
  if (!positiveStateAt) return positiveHistory;
  return positiveHistory.getTime() >= positiveStateAt.getTime()
    ? positiveHistory
    : positiveStateAt;
}

export function scoreRecallCandidate(
  input: ScoreRecallCandidateInput,
): RecallCandidate {
  const itemHistory = input.history.filter(
    (evidence) =>
      evidence.itemType === input.item.itemType &&
      evidence.itemId === input.item.itemId,
  );
  const lastPositiveMemoryEvidenceAt = findLastPositiveMemoryEvidenceAt(
    input.item.itemType,
    itemHistory,
    input.state,
    input.asOf,
  );
  const lastPresentedAt =
    input.state?.lastPresentedAt &&
    input.state.lastPresentedAt.getTime() <= input.asOf.getTime()
      ? input.state.lastPresentedAt
      : undefined;
  const fallbackEvidenceAt =
    lastPositiveMemoryEvidenceAt ?? input.lecture.lastStudiedAt;
  const weaknessScore = calculateRecallWeaknessScore(itemHistory, input.asOf);
  const forgettingUrgencyScore = calculateForgettingUrgencyScore(
    input.asOf,
    fallbackEvidenceAt,
  );
  const recencyPreferenceScore = calculateRecencyPreferenceScore(
    input.asOf,
    lastPresentedAt,
  );

  return {
    itemType: input.item.itemType,
    itemId: input.item.itemId,
    lectureId: input.item.lectureId,
    weaknessScore,
    forgettingUrgencyScore,
    recencyPreferenceScore,
    candidateScore: calculateRecallCandidateScore(
      weaknessScore,
      forgettingUrgencyScore,
      recencyPreferenceScore,
    ),
    candidateVersion: RECALL_CANDIDATE_VERSION,
    ...(lastPresentedAt ? { lastPresentedAt } : {}),
    ...(lastPositiveMemoryEvidenceAt
      ? { lastPositiveMemoryEvidenceAt }
      : {}),
  };
}

export function calculateRecallCandidateScore(
  weaknessScore: number,
  forgettingUrgencyScore: number,
  recencyPreferenceScore: number,
): number {
  return (
    clampInteger(weaknessScore, 0, 100) *
      RECALL_CANDIDATE_WEIGHTS.weakness +
    clampInteger(forgettingUrgencyScore, 0, 100) *
      RECALL_CANDIDATE_WEIGHTS.forgettingUrgency +
    clampInteger(recencyPreferenceScore, 0, 100) *
      RECALL_CANDIDATE_WEIGHTS.recency
  );
}

export function compareRecallCandidates(
  left: RecallCandidate,
  right: RecallCandidate,
): number {
  if (left.candidateScore !== right.candidateScore) {
    return right.candidateScore - left.candidateScore;
  }
  if (left.lastPresentedAt === undefined && right.lastPresentedAt !== undefined) {
    return -1;
  }
  if (left.lastPresentedAt !== undefined && right.lastPresentedAt === undefined) {
    return 1;
  }
  if (
    left.lastPresentedAt &&
    right.lastPresentedAt &&
    left.lastPresentedAt.getTime() !== right.lastPresentedAt.getTime()
  ) {
    return left.lastPresentedAt.getTime() - right.lastPresentedAt.getTime();
  }
  if (left.weaknessScore !== right.weaknessScore) {
    return right.weaknessScore - left.weaknessScore;
  }
  if (left.forgettingUrgencyScore !== right.forgettingUrgencyScore) {
    return right.forgettingUrgencyScore - left.forgettingUrgencyScore;
  }
  const itemTypeOrder =
    RECALL_CANDIDATE_ITEM_TYPE_ORDER[left.itemType] -
    RECALL_CANDIDATE_ITEM_TYPE_ORDER[right.itemType];
  if (itemTypeOrder !== 0) return itemTypeOrder;
  return compareText(left.itemId, right.itemId);
}

export function rankRecallCandidates(
  inputs: readonly ScoreRecallCandidateInput[],
): RecallCandidate[] {
  return inputs
    .map(scoreRecallCandidate)
    .sort(compareRecallCandidates);
}

function compareEvidenceNewestFirst(
  left: RecallMemoryEvidence,
  right: RecallMemoryEvidence,
): number {
  return (
    right.occurredAt.getTime() - left.occurredAt.getTime() ||
    compareText(left.source, right.source) ||
    compareText(left.sourceId, right.sourceId)
  );
}

function compareEvidenceOldestFirst(
  left: RecallMemoryEvidence,
  right: RecallMemoryEvidence,
): number {
  return (
    left.occurredAt.getTime() - right.occurredAt.getTime() ||
    compareText(left.source, right.source) ||
    compareText(left.sourceId, right.sourceId)
  );
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}