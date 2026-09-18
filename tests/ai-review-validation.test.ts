import assert from "node:assert/strict";
import test from "node:test";
import {
  isArabicText,
  validateFlashcardCandidate,
  validateMCQCandidate,
} from "../src/features/lectures/ai/validation/reviewValidation";

test("MCQ validation requires all choices and an answer", () => {
  const result = validateMCQCandidate({
    question: "Which option is correct?",
    optionA: "First",
    optionB: "Second",
    optionC: "",
    optionD: "Fourth",
    correctAnswer: null,
    category: "AI_GENERATED",
    difficulty: "Medium",
  });

  assert.equal(result.ready, false);
  assert.ok(result.errors.some((error) => error.includes("Option C")));
  assert.ok(result.errors.some((error) => error.includes("correct answer")));
});

test("MCQ validation rejects obvious duplicate options", () => {
  const result = validateMCQCandidate({
    question: "What is shown?",
    optionA: "A finding",
    optionB: " a finding ",
    optionC: "Another finding",
    optionD: "A third finding",
    correctAnswer: "A",
    category: "AI_GENERATED",
    difficulty: "Medium",
  });

  assert.equal(result.ready, false);
  assert.ok(result.errors.some((error) => error.includes("duplicates")));
});

test("locally edited MCQ becomes ready after completing missing answer", () => {
  const result = validateMCQCandidate({
    question: "What is shown?",
    optionA: "First",
    optionB: "Second",
    optionC: "Third",
    optionD: "Fourth",
    correctAnswer: "C",
    category: "AI_GENERATED",
    difficulty: "Medium",
  });

  assert.deepEqual(result, { ready: true, errors: [], warnings: [] });
});

test("flashcard validation allows a front to be reviewed before its back is added", () => {
  const result = validateFlashcardCandidate({
    clinicalConcept: "Renal clearance",
    explanation: null,
  });

  assert.equal(result.ready, false);
  assert.ok(result.errors.some((error) => error.includes("Explanation")));
});

test("flashcard validation becomes ready when both editable fields are present", () => {
  const result = validateFlashcardCandidate({
    clinicalConcept: "Renal clearance",
    explanation: "The volume of plasma cleared of a substance per unit time.",
  });

  assert.equal(result.ready, true);
});

test("Arabic source text is detected without changing the stored content", () => {
  assert.equal(isArabicText("The renal system الجهاز البولي"), true);
  assert.equal(isArabicText("Clinical lecture notes"), false);
});