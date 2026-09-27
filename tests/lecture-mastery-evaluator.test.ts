import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateLectureMasteryEvidence,
} from "../server/features/mastery/evaluator.js";
import {
  flashcardStudyQualityFromStatus,
} from "../server/features/mastery/postCommitHooks.js";
import type {
  FlashcardOutcome,
  LectureMasteryEvidence,
  ObjectiveOutcome,
} from "../server/features/mastery/types.js";

const baseTime = new Date("2026-09-27T10:00:00.000Z");

function makeEvidence(
  overrides: Partial<LectureMasteryEvidence> = {},
): LectureMasteryEvidence {
  return {
    userId: "user-1",
    lectureId: "lecture-1",
    asOf: baseTime,
    availableObjectiveItemCount: 10,
    objectiveOutcomes: [],
    flashcardOutcomes: [],
    lastRecallEvidenceAt: null,
    study: {
      meaningfulFocusSessionCount: 0,
      meaningfulFocusSeconds: 0,
      lastStudyEvidenceAt: null,
    },
    ...overrides,
  };
}

function objectiveOutcomes(
  count: number,
  options: {
    correct?: (index: number) => boolean;
    distinctItems?: number;
    source?: "MCQ" | "RECALL";
    at?: (index: number) => Date;
  } = {},
): ObjectiveOutcome[] {
  const distinctItems = Math.max(1, options.distinctItems ?? count);
  return Array.from({ length: count }, (_, index) => ({
    id: `objective-${String(index).padStart(3, "0")}`,
    itemId: `item-${index % distinctItems}`,
    occurredAt: options.at?.(index) ??
      new Date(baseTime.getTime() + index * 1_000),
    correct: options.correct?.(index) ?? true,
    source: options.source ?? "MCQ",
  }));
}

function flashcardOutcomes(
  values: readonly boolean[],
  source: "FLASHCARD" | "RECALL" = "FLASHCARD",
): FlashcardOutcome[] {
  return values.map((remembered, index) => ({
    id: `flashcard-${String(index).padStart(3, "0")}`,
    itemId: `card-${index}`,
    occurredAt: new Date(baseTime.getTime() + index * 1_000),
    remembered,
    source,
  }));
}

test("no canonical evidence remains NOT_STARTED", () => {
  const result = evaluateLectureMasteryEvidence(makeEvidence());
  assert.equal(result.state, "NOT_STARTED");
  assert.equal(result.evidenceScore, 0);
  assert.equal(result.evidenceCount, 0);
});

test("one objective interaction is STARTED and a small sample cannot master", () => {
  const result = evaluateLectureMasteryEvidence(makeEvidence({
    objectiveOutcomes: objectiveOutcomes(1),
  }));
  assert.equal(result.state, "STARTED");
  assert.notEqual(result.state, "MASTERED");
});

test("repeating one question cannot meet objective diversity", () => {
  const result = evaluateLectureMasteryEvidence(makeEvidence({
    objectiveOutcomes: objectiveOutcomes(20, { distinctItems: 1 }),
  }));
  assert.equal(result.distinctObjectiveItems, 1);
  assert.notEqual(result.state, "MASTERED");
});

test("strong objective evidence with recent support can become MASTERED", () => {
  const result = evaluateLectureMasteryEvidence(makeEvidence({
    objectiveOutcomes: objectiveOutcomes(10),
    flashcardOutcomes: flashcardOutcomes(Array(8).fill(true)),
  }));
  assert.equal(result.objectiveAccuracyPercent, 100);
  assert.equal(result.evidenceScore, 90);
  assert.equal(result.state, "MASTERED");
});

test("two misses in the latest three objective outcomes force NEEDS_REVIEW", () => {
  const result = evaluateLectureMasteryEvidence(makeEvidence({
    objectiveOutcomes: objectiveOutcomes(10, {
      correct: (index) => index !== 7 && index !== 8,
    }),
    flashcardOutcomes: flashcardOutcomes(Array(8).fill(true)),
  }));
  assert.equal(result.state, "NEEDS_REVIEW");
});

test("strong objective evidence outranks mixed Flashcard self-report", () => {
  const result = evaluateLectureMasteryEvidence(makeEvidence({
    objectiveOutcomes: objectiveOutcomes(10),
    flashcardOutcomes: flashcardOutcomes([true, false, false], "RECALL"),
  }));
  assert.equal(result.state, "GOOD");
});

test("repeated recent Flashcard failures need review without strong objective evidence", () => {
  const result = evaluateLectureMasteryEvidence(makeEvidence({
    objectiveOutcomes: objectiveOutcomes(4),
    flashcardOutcomes: flashcardOutcomes([true, false, false], "RECALL"),
  }));
  assert.equal(result.state, "NEEDS_REVIEW");
});

test("limited-content lectures can reach GOOD but cannot reach MASTERED", () => {
  const good = evaluateLectureMasteryEvidence(makeEvidence({
    availableObjectiveItemCount: 2,
    objectiveOutcomes: objectiveOutcomes(5, { distinctItems: 2 }),
    flashcardOutcomes: flashcardOutcomes(Array(5).fill(true)),
    study: {
      meaningfulFocusSessionCount: 1,
      meaningfulFocusSeconds: 10 * 60,
      lastStudyEvidenceAt: baseTime,
    },
  }));
  assert.equal(good.state, "GOOD");

  const tooFewItems = evaluateLectureMasteryEvidence(makeEvidence({
    availableObjectiveItemCount: 2,
    objectiveOutcomes: objectiveOutcomes(20, { distinctItems: 2 }),
    flashcardOutcomes: flashcardOutcomes(Array(20).fill(true)),
    study: {
      meaningfulFocusSessionCount: 4,
      meaningfulFocusSeconds: 90 * 60,
      lastStudyEvidenceAt: baseTime,
    },
  }));
  assert.equal(tooFewItems.state, "GOOD");
});

test("without valid objective items, time and Flashcards cannot claim GOOD or MASTERED", () => {
  const result = evaluateLectureMasteryEvidence(makeEvidence({
    availableObjectiveItemCount: 0,
    flashcardOutcomes: flashcardOutcomes(Array(20).fill(true)),
    study: {
      meaningfulFocusSessionCount: 10,
      meaningfulFocusSeconds: 90 * 60,
      lastStudyEvidenceAt: baseTime,
    },
  }));
  assert.equal(result.state, "LEARNING");
});

test("objective and Flashcard windows are bounded to the latest 20 outcomes", () => {
  const result = evaluateLectureMasteryEvidence(makeEvidence({
    objectiveOutcomes: objectiveOutcomes(25),
    flashcardOutcomes: flashcardOutcomes(Array(25).fill(true)),
  }));
  assert.equal(result.objectiveAttemptCount, 20);
  assert.equal(result.flashcardReviewCount, 20);
});

test("same-timestamp outcomes use stable ID ordering", () => {
  const tied = objectiveOutcomes(4, {
    correct: (index) => index === 0 || index === 1,
    at: () => baseTime,
  });
  const result = evaluateLectureMasteryEvidence(makeEvidence({
    objectiveOutcomes: tied,
  }));
  assert.equal(result.objectiveAttemptCount, 4);
  assert.equal(result.objectiveIncorrectCount, 2);
  assert.equal(result.state, "NEEDS_REVIEW");
});

test("existing Flashcard batch ratings map into Study Event quality values", () => {
  assert.equal(flashcardStudyQualityFromStatus("easy"), "EASY");
  assert.equal(flashcardStudyQualityFromStatus("medium"), "HARD");
  assert.equal(flashcardStudyQualityFromStatus("hard"), "HARD");
  assert.equal(flashcardStudyQualityFromStatus("unknown"), null);
});