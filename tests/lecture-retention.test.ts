import assert from "node:assert/strict";
import test from "node:test";
import { detectLectureForgetting } from "../server/features/mastery/forgettingDetection.js";
import { evaluateLectureRetention } from "../server/features/mastery/retentionEvaluator.js";
import type {
  LectureRetentionMemoryEvidence,
  RetentionMasterySource,
} from "../server/features/mastery/retentionTypes.js";
import type {
  FlashcardOutcome,
  ObjectiveOutcome,
} from "../server/features/mastery/types.js";

const DAY = 24 * 60 * 60 * 1000;
const anchor = new Date("2026-01-01T00:00:00.000Z");
const userId = "retention-test-user";
const lectureId = "retention-test-lecture";

function mastery(
  state: RetentionMasterySource["state"],
  evidenceScore: number,
): RetentionMasterySource & { userId: string; lectureId: string } {
  return {
    userId,
    lectureId,
    state,
    evidenceScore,
    revision: 7,
    ruleVersion: "mastery-v1",
  };
}

function evidence(
  objectiveOutcomes: ObjectiveOutcome[] = [],
  flashcardOutcomes: FlashcardOutcome[] = [],
): LectureRetentionMemoryEvidence {
  return {
    userId,
    lectureId,
    asOf: new Date(anchor),
    objectiveOutcomes,
    flashcardOutcomes,
  };
}

function objective(
  id: string,
  itemId: string,
  days: number,
  correct: boolean,
): ObjectiveOutcome {
  return {
    id,
    itemId,
    occurredAt: new Date(anchor.getTime() + days * DAY),
    correct,
    source: "MCQ",
  };
}

function flashcard(
  id: string,
  itemId: string,
  days: number,
  remembered: boolean,
): FlashcardOutcome {
  return {
    id,
    itemId,
    occurredAt: new Date(anchor.getTime() + days * DAY),
    remembered,
    source: "FLASHCARD",
  };
}

test("retention without bounded memory evidence preserves evidence Mastery", () => {
  const result = evaluateLectureRetention({
    mastery: mastery("MASTERED", 92),
    memoryEvidence: evidence(),
    asOf: new Date(anchor.getTime() + 365 * DAY),
  });

  assert.equal(result.effectiveMasteryState, "MASTERED");
  assert.equal(result.retentionScore, null);
  assert.equal(result.reviewState, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.reviewUrgencyScore, 0);
  assert.equal(result.retentionAnchorAt, null);
  assert.equal(result.nextReviewAt, null);
  assert.equal(result.nextEvaluationAt, null);
});

test("review intervals, half-interval boundaries, and deterministic evaluation times", () => {
  const memory = evidence([objective("a", "item-a", 0, true)]);
  const at = (days: number) =>
    evaluateLectureRetention({
      mastery: mastery("MASTERED", 90),
      memoryEvidence: memory,
      asOf: new Date(anchor.getTime() + days * DAY),
    });

  assert.equal(at(0).reviewState, "FRESH");
  assert.equal(at(6).reviewState, "FRESH");
  assert.equal(at(7).reviewState, "DUE_SOON");
  assert.equal(at(13).reviewState, "DUE_SOON");
  assert.equal(at(14).reviewState, "DUE");
  assert.equal(at(27).reviewState, "DUE");
  assert.equal(at(28).reviewState, "OVERDUE");
  assert.equal(at(0).nextReviewAt?.getTime(), anchor.getTime() + 14 * DAY);
  assert.equal(at(0).nextEvaluationAt?.getTime(), anchor.getTime() + 7 * DAY);
  assert.equal(at(14).nextEvaluationAt?.getTime(), anchor.getTime() + 28 * DAY);
  assert.equal(at(28).nextEvaluationAt?.getTime(), anchor.getTime() + 42 * DAY);
});

test("decay begins after two intervals and can only lower effective Mastery", () => {
  const memory = evidence([objective("a", "item-a", 0, true)]);
  const evaluateAt = (days: number, state: RetentionMasterySource["state"], score: number) =>
    evaluateLectureRetention({
      mastery: mastery(state, score),
      memoryEvidence: memory,
      asOf: new Date(anchor.getTime() + days * DAY),
    });

  assert.equal(evaluateAt(27, "MASTERED", 85).retentionScore, 85);
  assert.equal(evaluateAt(28, "MASTERED", 85).retentionScore, 75);
  assert.equal(evaluateAt(28, "MASTERED", 85).effectiveMasteryState, "GOOD");
  assert.equal(evaluateAt(56, "MASTERED", 85).retentionScore, 55);
  assert.equal(evaluateAt(56, "MASTERED", 85).effectiveMasteryState, "LEARNING");
  assert.equal(evaluateAt(84, "MASTERED", 85).retentionScore, 35);
  assert.equal(evaluateAt(84, "MASTERED", 85).effectiveMasteryState, "NEEDS_REVIEW");
  assert.equal(evaluateAt(90, "STARTED", 4).effectiveMasteryState, "STARTED");
  assert.equal(evaluateAt(90, "STARTED", 4).retentionScore, 0);
});

test("base evidence score is normalized into the semantic state band", () => {
  const memory = evidence([objective("a", "item-a", 0, true)]);
  const evaluate = (
    state: RetentionMasterySource["state"],
    evidenceScore: number,
  ) =>
    evaluateLectureRetention({
      mastery: mastery(state, evidenceScore),
      memoryEvidence: memory,
      asOf: new Date(anchor),
    });

  assert.equal(evaluate("STARTED", 90).retentionScore, 39);
  assert.equal(evaluate("LEARNING", 2).retentionScore, 40);
  assert.equal(evaluate("NEEDS_REVIEW", 90).retentionScore, 39);
  assert.equal(evaluate("GOOD", 1).retentionScore, 65);
  assert.equal(evaluate("MASTERED", 1).retentionScore, 85);
  assert.equal(evaluate("NOT_STARTED", 80).retentionScore, 0);
  assert.equal(evaluate("NOT_STARTED", 80).effectiveMasteryState, "NOT_STARTED");
});

test("NEEDS_REVIEW is due immediately and active forgetting forces urgency 100", () => {
  const forgottenAt = new Date(anchor.getTime() + 2 * DAY);
  const memory = evidence([
    objective("first", "item-a", 0, true),
    objective("later", "item-a", 2, false),
  ]);
  const result = evaluateLectureRetention({
    mastery: mastery("NEEDS_REVIEW", 90),
    memoryEvidence: memory,
    asOf: new Date(anchor.getTime() + 3 * DAY),
  });

  assert.equal(result.retentionScore, 39);
  assert.equal(result.effectiveMasteryState, "NEEDS_REVIEW");
  assert.equal(result.reviewState, "DUE");
  assert.equal(result.reviewUrgencyScore, 100);
  assert.equal(result.nextReviewAt?.getTime(), forgottenAt.getTime());
  assert.equal(result.lastForgettingEvidenceAt?.getTime(), forgottenAt.getTime());
  assert.equal(result.forgettingEvidenceKind, "OBJECTIVE");
});

test("STARTED uses one day, LEARNING three days, and GOOD seven days", () => {
  const memory = evidence([objective("a", "item-a", 0, true)]);
  const interval = (
    state: RetentionMasterySource["state"],
    score: number,
  ) =>
    evaluateLectureRetention({
      mastery: mastery(state, score),
      memoryEvidence: memory,
      asOf: new Date(anchor),
    }).nextReviewAt?.getTime();

  assert.equal(interval("STARTED", 10), anchor.getTime() + DAY);
  assert.equal(interval("LEARNING", 45), anchor.getTime() + 3 * DAY);
  assert.equal(interval("GOOD", 70), anchor.getTime() + 7 * DAY);
});

test("forgetting requires the same item and at least 24 hours, and recovery clears active status", () => {
  const underMinimum = detectLectureForgetting(
    evidence([
      objective("positive", "item-a", 0, true),
      objective("negative", "item-a", 0.99, false),
    ]),
    new Date(anchor.getTime() + 2 * DAY),
  );
  assert.equal(underMinimum.objectiveForgettingItemCount, 0);
  assert.equal(underMinimum.forgettingEvidenceKind, "NONE");

  const differentItem = detectLectureForgetting(
    evidence([
      objective("positive", "item-a", 0, true),
      objective("negative", "item-b", 2, false),
    ]),
    new Date(anchor.getTime() + 3 * DAY),
  );
  assert.equal(differentItem.objectiveForgettingItemCount, 0);

  const recovered = detectLectureForgetting(
    evidence([
      objective("positive", "item-a", 0, true),
      objective("negative", "item-a", 2, false),
      objective("recovery", "item-a", 3, true),
    ]),
    new Date(anchor.getTime() + 4 * DAY),
  );
  assert.equal(recovered.objectiveForgettingItemCount, 0);
  assert.equal(recovered.lastForgettingEvidenceAt, null);
  assert.equal(recovered.lastPositiveMemoryEvidenceAt?.getTime(), anchor.getTime() + 3 * DAY);
});

test("flashcard reports stay separate and active source kinds combine as MIXED", () => {
  const summary = detectLectureForgetting(
    evidence(
      [
        objective("mcq-positive", "mcq-a", 0, true),
        objective("mcq-negative", "mcq-a", 2, false),
      ],
      [
        flashcard("card-positive", "card-a", 0, true),
        flashcard("card-negative", "card-a", 3, false),
      ],
    ),
    new Date(anchor.getTime() + 4 * DAY),
  );

  assert.equal(summary.objectiveForgettingItemCount, 1);
  assert.equal(summary.selfReportedForgettingItemCount, 1);
  assert.equal(summary.forgettingEvidenceKind, "MIXED");
  assert.equal(summary.lastForgettingEvidenceAt?.getTime(), anchor.getTime() + 3 * DAY);
});

test("equal-time outcomes use stable ID order without creating a forgetting transition", () => {
  const summary = detectLectureForgetting(
    evidence([
      objective("a-positive", "item-a", 0, true),
      objective("b-negative", "item-a", 0, false),
    ]),
    new Date(anchor.getTime() + DAY),
  );
  assert.equal(summary.objectiveForgettingItemCount, 0);
});