import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const lectureDetail = readFileSync(
  new URL("../src/features/lectures/components/LectureDetailView.tsx", import.meta.url),
  "utf8",
);
const subjectArtwork = readFileSync(
  new URL("../src/features/lectures/components/SubjectFlashcardArtwork.tsx", import.meta.url),
  "utf8",
);
const metadata = readFileSync(
  new URL("../shared/mcqMetadata.ts", import.meta.url),
  "utf8",
);
const adminMcq = readFileSync(
  new URL("../src/features/lectures/components/CreateMCQ.tsx", import.meta.url),
  "utf8",
);

test("MCQ and Flashcard generic shells use exact Classic 99 tokens", () => {
  assert.match(lectureDetail, /bg-semantic-surface-elevated/);
  assert.match(lectureDetail, /text-semantic-chrome-content-primary/);
  assert.match(lectureDetail, /text-semantic-chrome-content-secondary/);
  assert.match(lectureDetail, /activeTab === "mcqs"/);
  assert.match(lectureDetail, /activeTab === "flashcards"/);
});

test("MCQ difficulty remains fixed and independent from user theme", () => {
  assert.match(lectureDetail, /difficulty === "Easy"/);
  assert.match(lectureDetail, /difficulty === "Hard"/);
  assert.match(lectureDetail, /bg-emerald-100 text-emerald-800 dark:bg-emerald-950\/60 dark:text-emerald-200/);
  assert.match(lectureDetail, /bg-rose-100 text-rose-800 dark:bg-rose-950\/60 dark:text-rose-200/);
  assert.match(lectureDetail, /bg-amber-100 text-amber-800 dark:bg-amber-950\/60 dark:text-amber-200/);
  assert.doesNotMatch(lectureDetail, /themeId|semantic-action-accent|semantic-navigation-tab-active/);
});

test("MCQ correctness and selected-answer semantics remain direct", () => {
  assert.match(lectureDetail, /const isCorrect = verified \? verified\.correct : selected === correct/);
  assert.match(lectureDetail, /bg-emerald-500\/10 text-emerald-800/);
  assert.match(lectureDetail, /bg-rose-500\/10 text-rose-800/);
  assert.match(lectureDetail, /CORRECT ✓/);
  assert.match(lectureDetail, /INCORRECT ✗/);
  assert.match(lectureDetail, /isSelected/);
  assert.match(lectureDetail, /backgroundColor: `rgba\(\$\{flashcardTheme\.rgb\}, 0\.11\)`/);
});

test("MCQ categories and virtual All filter remain unchanged", () => {
  assert.match(metadata, /MCQ_CATEGORY_FILTERS = \["ALL", \.\.\.MCQ_CATEGORIES\]/);
  assert.match(metadata, /PREVIOUS_YEAR/);
  assert.match(metadata, /AI_GENERATED/);
  assert.match(metadata, /RESOURCE/);
  assert.match(lectureDetail, /quizSource === "ALL"/);
  assert.match(lectureDetail, /normalizeMCQCategory\(q\.sourceType\)/);
  assert.match(lectureDetail, /setQuizSource\(category\)/);
});

test("Flashcard subject identity and review semantics remain direct", () => {
  assert.match(lectureDetail, /const getFlashcardTheme = \(subjectId\?: string\)/);
  assert.match(lectureDetail, /useMemo\(\(\) => getFlashcardTheme\(lecture\.subjectId\)/);
  assert.match(lectureDetail, /<SubjectFlashcardArtwork/);
  assert.match(subjectArtwork, /artworkMap/);
  assert.match(subjectArtwork, /dark:hidden/);
  assert.match(subjectArtwork, /dark:block/);
  assert.match(lectureDetail, /handleCardRate\("hard"\)/);
  assert.match(lectureDetail, /handleCardRate\("medium"\)/);
  assert.match(lectureDetail, /handleCardRate\("easy"\)/);
  assert.match(lectureDetail, /bg-rose-500/);
  assert.match(lectureDetail, /bg-amber-500/);
  assert.match(lectureDetail, /bg-emerald-500/);
});

test("Flashcard front, explanation, progress, tags, and keyboard paths remain intact", () => {
  assert.match(lectureDetail, /key="flashcard-question"/);
  assert.match(lectureDetail, /key="flashcard-explanation"/);
  assert.match(lectureDetail, /currentFlashcard\?\.front/);
  assert.match(lectureDetail, /currentFlashcard\?\.back/);
  assert.match(lectureDetail, /currentCardIndex \+ 1\}\/\{activeCards\.length/);
  assert.match(lectureDetail, /e\.code === "Space"/);
  assert.match(lectureDetail, /setIsFlipped\(\(prev\) => !prev\)/);
  assert.match(lectureDetail, /flashcardsCompleted/);
  assert.match(lectureDetail, /Clinical Concept|CLINICAL CONCEPT/);
  assert.match(lectureDetail, /Explanation|EXPLANATION/);
});

test("Prompt 10 does not expand into admin MCQ or runtime theme behavior", () => {
  assert.match(adminMcq, /correctAnswer/);
  assert.match(adminMcq, /difficulty/);
  assert.match(adminMcq, /category/);
  assert.doesNotMatch(adminMcq, /themeId|semantic-action-accent|semantic-navigation-tab-active/);
  assert.doesNotMatch(lectureDetail, /dataset\.theme|style\.setProperty|location\.reload|reload\(\)/);
});