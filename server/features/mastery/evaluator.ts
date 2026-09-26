import { MASTERY_STATES, type MasteryState } from "../study-core/constants.js";
import {
  MASTERY_FLASHCARD_SAMPLE_CONFIDENCE,
  MASTERY_FLASHCARD_WINDOW,
  MASTERY_LIMITS,
  MASTERY_OBJECTIVE_SAMPLE_CONFIDENCE,
  MASTERY_OBJECTIVE_WINDOW,
  MASTERY_RULE_VERSION,
  MASTERY_STUDY_SCORE_TIERS,
} from "./constants.js";
import type {
  FlashcardOutcome,
  LectureMasteryEvidence,
  LectureMasteryEvaluation,
  ObjectiveOutcome,
} from "./types.js";

export function evaluateLectureMasteryEvidence(
  evidence: LectureMasteryEvidence,
): LectureMasteryEvaluation {
  const objective = stableRecent(
    evidence.objectiveOutcomes,
    MASTERY_OBJECTIVE_WINDOW,
  );
  const flashcards = stableRecent(
    evidence.flashcardOutcomes,
    MASTERY_FLASHCARD_WINDOW,
  );
  const objectiveAttemptCount = objective.length;
  const objectiveCorrectCount = objective.filter((item) => item.correct).length;
  const objectiveIncorrectCount = objectiveAttemptCount - objectiveCorrectCount;
  const recallObjective = objective.filter((item) => item.source === "RECALL");
  const recallObjectiveCorrectCount = recallObjective.filter((item) => item.correct).length;
  const recallObjectiveIncorrectCount = recallObjective.length - recallObjectiveCorrectCount;
  const flashcardReviewCount = flashcards.length;
  const flashcardRememberedCount = flashcards.filter((item) => item.remembered).length;
  const flashcardNotRememberedCount = flashcardReviewCount - flashcardRememberedCount;
  const distinctObjectiveItems = new Set(objective.map((item) => item.itemId)).size;
  const availableObjectiveItemCount = Math.max(0, evidence.availableObjectiveItemCount);
  const objectiveAccuracyPercent = objectiveAttemptCount === 0
    ? null
    : Math.floor((objectiveCorrectCount * 100) / objectiveAttemptCount);

  const requiredDistinctForGood = Math.min(
    MASTERY_LIMITS.objectiveGoodDistinctItems,
    availableObjectiveItemCount,
  );
  const requiredDistinctForMastered = Math.min(
    MASTERY_LIMITS.objectiveMasteredDistinctItems,
    availableObjectiveItemCount,
  );
  const objectiveComponent = scoreObjective({
    correct: objectiveCorrectCount,
    attempts: objectiveAttemptCount,
    distinctItems: distinctObjectiveItems,
    requiredDistinctItems: requiredDistinctForMastered,
  });
  const flashcardComponent = scoreFlashcards(
    flashcardRememberedCount,
    flashcardReviewCount,
  );
  const studyComponent = scoreStudy(evidence.study.meaningfulFocusSeconds);
  const evidenceScore = Math.min(
    100,
    objectiveComponent + flashcardComponent + studyComponent,
  );
  const evidenceCount =
    objectiveAttemptCount +
    flashcardReviewCount +
    Math.max(0, evidence.study.meaningfulFocusSessionCount);

  const lastObjectiveEvidenceAt = latestDate(objective.map((item) => item.occurredAt));
  const lastRecallEvidenceAt = latestDate([
    evidence.lastRecallEvidenceAt,
    ...objective.filter((item) => item.source === "RECALL").map((item) => item.occurredAt),
    ...flashcards.filter((item) => item.source === "RECALL").map((item) => item.occurredAt),
  ]);
  const lastStudyEvidenceAt = latestDate([
    evidence.study.lastStudyEvidenceAt,
    lastObjectiveEvidenceAt,
    latestDate(flashcards.map((item) => item.occurredAt)),
  ]);

  const objectiveFailureOverride = hasObjectiveFailureOverride(objective);
  const lowObjectiveAccuracy =
    objectiveAttemptCount >= MASTERY_LIMITS.objectiveLowAccuracyMinimumAttempts &&
    objectiveCorrectCount * 100 <
      objectiveAttemptCount * MASTERY_LIMITS.objectiveLowAccuracyPercent;
  const objectiveStrong =
    objectiveAttemptCount >= MASTERY_LIMITS.objectiveGoodAttempts &&
    objectiveCorrectCount * 100 >=
      objectiveAttemptCount * MASTERY_LIMITS.objectiveGoodAccuracyPercent &&
    !objectiveFailureOverride;
  const flashcardFailureOverride =
    hasFlashcardFailureOverride(flashcards) && !objectiveStrong;

  let state: MasteryState;
  if (evidenceCount === 0) {
    state = MASTERY_STATES[0];
  } else if (objectiveFailureOverride || lowObjectiveAccuracy || flashcardFailureOverride) {
    state = "NEEDS_REVIEW";
  } else if (
    availableObjectiveItemCount >=
      MASTERY_LIMITS.minimumDistinctItemsWhenInventoryHasThree &&
    objectiveAttemptCount >= MASTERY_LIMITS.objectiveMasteredAttempts &&
    requiredDistinctForMastered >=
      MASTERY_LIMITS.minimumDistinctItemsWhenInventoryHasThree &&
    distinctObjectiveItems >= requiredDistinctForMastered &&
    objectiveCorrectCount * 100 >=
      objectiveAttemptCount * MASTERY_LIMITS.objectiveMasteredAccuracyPercent &&
    evidenceScore >= MASTERY_LIMITS.masteredEvidenceScore
  ) {
    state = "MASTERED";
  } else {
    const limitedContent = availableObjectiveItemCount > 0 &&
      availableObjectiveItemCount <
        MASTERY_LIMITS.minimumDistinctItemsWhenInventoryHasThree;
    const hasSupportingEvidence = flashcardReviewCount > 0 ||
      evidence.study.meaningfulFocusSessionCount > 0;
    const goodAccuracyThreshold = limitedContent
      ? MASTERY_LIMITS.limitedContentGoodAccuracyPercent
      : MASTERY_LIMITS.objectiveGoodAccuracyPercent;
    const satisfiesGood =
      availableObjectiveItemCount > 0 &&
      objectiveAttemptCount >= MASTERY_LIMITS.objectiveGoodAttempts &&
      requiredDistinctForGood > 0 &&
      distinctObjectiveItems >= requiredDistinctForGood &&
      objectiveCorrectCount * 100 >= objectiveAttemptCount * goodAccuracyThreshold &&
      evidenceScore >= MASTERY_LIMITS.goodEvidenceScore &&
      (!limitedContent ||
        !MASTERY_LIMITS.limitedContentGoodRequiresSupportingEvidence ||
        hasSupportingEvidence);

    if (satisfiesGood) {
      state = "GOOD";
    } else if (evidenceCount < MASTERY_LIMITS.minimumEvidenceCountForLearning) {
      state = "STARTED";
    } else {
      state = "LEARNING";
    }
  }

  return {
    userId: evidence.userId,
    lectureId: evidence.lectureId,
    state,
    evidenceScore,
    evidenceCount,
    objectiveAttemptCount,
    objectiveCorrectCount,
    objectiveIncorrectCount,
    flashcardReviewCount,
    flashcardRememberedCount,
    flashcardNotRememberedCount,
    recallObjectiveAttemptCount: recallObjective.length,
    recallObjectiveCorrectCount,
    recallObjectiveIncorrectCount,
    meaningfulFocusSessionCount: Math.max(
      0,
      evidence.study.meaningfulFocusSessionCount,
    ),
    meaningfulFocusSeconds: Math.max(0, evidence.study.meaningfulFocusSeconds),
    lastStudyEvidenceAt,
    lastObjectiveEvidenceAt,
    lastRecallEvidenceAt,
    ruleVersion: MASTERY_RULE_VERSION,
    objectiveAccuracyPercent,
    distinctObjectiveItems,
    availableObjectiveItemCount,
    componentScores: {
      objectiveComponent,
      flashcardComponent,
      studyComponent,
    },
  };
}

function scoreObjective(input: {
  correct: number;
  attempts: number;
  distinctItems: number;
  requiredDistinctItems: number;
}): number {
  if (
    input.attempts <= 0 ||
    input.requiredDistinctItems <= 0 ||
    input.distinctItems <= 0
  ) {
    return 0;
  }
  const confidence = sampleConfidence(
    input.attempts,
    MASTERY_OBJECTIVE_SAMPLE_CONFIDENCE,
  );
  const diversity = Math.min(input.distinctItems, input.requiredDistinctItems);
  return Math.floor(
    (70 * input.correct * confidence * diversity) /
      (input.attempts * 100 * input.requiredDistinctItems),
  );
}

function scoreFlashcards(remembered: number, reviews: number): number {
  if (reviews <= 0) return 0;
  const confidence = sampleConfidence(
    reviews,
    MASTERY_FLASHCARD_SAMPLE_CONFIDENCE,
  );
  return Math.floor((20 * remembered * confidence) / (reviews * 100));
}

function scoreStudy(seconds: number): number {
  for (const tier of MASTERY_STUDY_SCORE_TIERS) {
    if (seconds >= tier.minimumSeconds) return tier.score;
  }
  return 0;
}

function sampleConfidence(
  count: number,
  map: readonly number[],
): number {
  return map[Math.min(count, map.length - 1)] ?? 0;
}

function hasObjectiveFailureOverride(
  outcomes: readonly ObjectiveOutcome[],
): boolean {
  const recent = stableRecent(outcomes, MASTERY_LIMITS.objectiveFailureWindow);
  return recent.length === MASTERY_LIMITS.objectiveFailureWindow &&
    recent.filter((item) => !item.correct).length >=
      MASTERY_LIMITS.objectiveFailuresForNeedsReview;
}

function hasFlashcardFailureOverride(
  outcomes: readonly FlashcardOutcome[],
): boolean {
  const recent = stableRecent(outcomes, MASTERY_LIMITS.flashcardFailureWindow);
  return recent.length === MASTERY_LIMITS.flashcardFailureWindow &&
    recent.filter((item) => !item.remembered).length >=
      MASTERY_LIMITS.flashcardFailuresForNeedsReview;
}

function stableRecent<T extends { occurredAt: Date; id: string }>(
  items: readonly T[],
  limit: number,
): T[] {
  return [...items]
    .sort(
      (left, right) =>
        right.occurredAt.getTime() - left.occurredAt.getTime() ||
        compareText(right.id, left.id),
    )
    .slice(0, limit);
}

function latestDate(values: readonly (Date | null | undefined)[]): Date | null {
  let latest: Date | null = null;
  for (const value of values) {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) continue;
    if (!latest || value.getTime() > latest.getTime()) latest = value;
  }
  return latest;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}