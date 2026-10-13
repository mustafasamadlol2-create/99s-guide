import assert from "node:assert/strict";
import test from "node:test";
import {
  isArabicText,
  validateFlashcardCandidate,
  validateMCQCandidate,
} from "../src/features/lectures/ai/validation/reviewValidation";
import { localizeAIError, localizeAIWarning } from "../src/features/lectures/ai/i18n";

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


test("human review overrides stale AI review flags once the flashcard is structurally valid", () => {
  const candidate = {
    clinicalConcept: "Renal clearance",
    explanation: "The volume of plasma cleared of a substance per unit time.",
    importReady: false,
    needsReview: true,
    warnings: [
      "Confidence is below the review threshold.",
      "Review source wording before import.",
    ],
  };

  const beforeHumanReview = validateFlashcardCandidate(candidate);
  assert.equal(beforeHumanReview.ready, false);

  const afterHumanReview = validateFlashcardCandidate(candidate, { humanReviewed: true });
  assert.equal(afterHumanReview.ready, true);
  assert.equal(afterHumanReview.errors.length, 0);
  assert.equal(afterHumanReview.warnings.length, 2);
});

test("human review never bypasses structural flashcard errors", () => {
  const result = validateFlashcardCandidate({
    clinicalConcept: "Renal clearance",
    explanation: "",
    importReady: false,
    needsReview: true,
    warnings: ["Confidence is below the review threshold."],
  }, { humanReviewed: true });

  assert.equal(result.ready, false);
  assert.ok(result.errors.some((error) => error.includes("Explanation")));
});

test("Arabic source text is detected without changing the stored content", () => {
  assert.equal(isArabicText("The renal system الجهاز البولي"), true);
  assert.equal(isArabicText("Clinical lecture notes"), false);
});

test("review validation keeps flagged candidates out of the import-ready state", () => {
  const result = validateMCQCandidate({
    question: "Which option is supported by the source?",
    optionA: "First",
    optionB: "Second",
    optionC: "Third",
    optionD: "Fourth",
    correctAnswer: "A",
    category: "AI_GENERATED",
    difficulty: "Medium",
    importReady: true,
    needsReview: true,
    warnings: ["Confidence is below the review threshold."],
  });

  assert.equal(result.ready, false);
  assert.ok(result.warnings.length > 0);
});



test("human review overrides stale AI review flags once the MCQ is structurally valid", () => {
  const candidate = {
    question: "All these diseases are produced by exotoxins except:",
    optionA: "Scalded skin syndrome",
    optionB: "Food poisoning",
    optionC: "Meningitis",
    optionD: "Toxic shock syndrome",
    correctAnswer: "D" as const,
    category: "AI_GENERATED" as const,
    difficulty: "Medium" as const,
    importReady: false,
    needsReview: true,
    warnings: [
      "The source did not explicitly establish a correct answer.",
      "Confidence is below the review threshold.",
    ],
  };

  const beforeHumanReview = validateMCQCandidate(candidate);
  assert.equal(beforeHumanReview.ready, false);

  const afterHumanReview = validateMCQCandidate(candidate, { humanReviewed: true });
  assert.equal(afterHumanReview.ready, true);
  assert.equal(afterHumanReview.errors.length, 0);
  assert.equal(afterHumanReview.warnings.length, 2);
});

test("human review never bypasses structural MCQ errors", () => {
  const result = validateMCQCandidate({
    question: "Which option is correct?",
    optionA: "First",
    optionB: "Second",
    optionC: "",
    optionD: "Fourth",
    correctAnswer: "D",
    category: "AI_GENERATED",
    difficulty: "Medium",
    importReady: false,
    needsReview: true,
    warnings: ["The source did not explicitly establish a correct answer."],
  }, { humanReviewed: true });

  assert.equal(result.ready, false);
  assert.ok(result.errors.some((error) => error.includes("Option C")));
});

test("review warnings and import errors are localized without exposing internal codes", () => {
  assert.equal(
    localizeAIWarning("en", "AI_IMPORT_INVALID_CANDIDATE"),
    "Review this item before import.",
  );
  assert.equal(
    localizeAIWarning("ar", "The source did not explicitly establish a correct answer."),
    "لم يحدد المصدر إجابة صحيحة. راجع هذا العنصر قبل الاستيراد.",
  );
  assert.equal(
    localizeAIError("en", { code: "AI_IMPORT_CONFLICT" }),
    "The lecture changed during import. Refresh the review and try again.",
  );
});