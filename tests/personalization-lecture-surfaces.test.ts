import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const lectureList = readFileSync(
  new URL("../src/features/lectures/components/LectureListItem.tsx", import.meta.url),
  "utf8",
);
const lectureDetail = readFileSync(
  new URL("../src/features/lectures/components/LectureDetailView.tsx", import.meta.url),
  "utf8",
);
const videoCard = readFileSync(
  new URL("../src/features/lectures/components/VideoCard.tsx", import.meta.url),
  "utf8",
);

test("lecture list and video surfaces use only exact generic presentation tokens", () => {
  assert.match(lectureList, /text-semantic-chrome-content-primary/);
  assert.match(lectureList, /text-semantic-chrome-content-secondary/);
  assert.doesNotMatch(lectureList, /semantic-action-accent|semantic-navigation-tab-active/);

  assert.match(videoCard, /bg-semantic-surface-elevated/);
  assert.match(videoCard, /text-semantic-chrome-content-primary/);
  assert.match(videoCard, /text-semantic-chrome-content-subtle/);
  assert.match(videoCard, /onWatch/);
});

test("lecture detail generic shells consume approved tokens", () => {
  assert.match(lectureDetail, /bg-semantic-surface-elevated/);
  assert.match(lectureDetail, /text-semantic-chrome-content-primary/);
  assert.match(lectureDetail, /bg-semantic-action-accent/);
  assert.match(lectureDetail, /text-semantic-navigation-tab-active/);
  assert.match(lectureDetail, /bg-semantic-navigation-active-background/);
});

test("lecture tab geometry and navigation contracts remain unchanged", () => {
  assert.match(
    lectureDetail,
    /grid grid-cols-6 sm:flex items-center select-none h-\[44px\] sm:h-\[40px\] w-full sm:w-\[420px\] sm:min-w-\[420px\] sm:max-w-\[420px\] sm:flex-\[0_0_420px\]/,
  );
  assert.match(lectureDetail, /data-lecture-section-tabs/);
  assert.match(lectureDetail, /lectureTabPager\.surfaceRef/);
  assert.match(lectureDetail, /handleLectureTabChange/);
  assert.match(lectureDetail, /useHorizontalSwipePager/);
  assert.match(lectureDetail, /data-swipe-back-disabled="true"/);
});

test("MCQ and flashcard semantic colors remain direct and independent", () => {
  assert.match(lectureDetail, /activeTab === "mcqs"/);
  assert.match(lectureDetail, /bg-amber-100 text-amber-800 dark:bg-amber-950\/60 dark:text-amber-200/);
  assert.match(lectureDetail, /text-amber-500/);
  assert.match(lectureDetail, /flashcardThemeVars/);
  assert.match(lectureDetail, /--flashcard-accent/);
  assert.match(lectureDetail, /handleCardRate/);
});

test("PDF, Notes, Video, and Q&A behavior/security paths remain present", () => {
  assert.match(lectureDetail, /resolveExternalPdfUrl/);
  assert.match(lectureDetail, /NativeBridge\.openPdfUrl/);
  assert.match(lectureDetail, /apiClient\("\/api\/progress\/view"/);
  assert.match(lectureDetail, /targetType = activeTab === "pdf" \? "PDF" : "NOTE"/);
  assert.match(lectureDetail, /noteMaterials/);
  assert.match(lectureDetail, /handleWatchVideo/);
  assert.match(lectureDetail, /NativeBridge\.openYouTubeUrl/);
  assert.match(lectureDetail, /fetchQA/);
  assert.match(lectureDetail, /ReportSheet/);
  assert.match(lectureDetail, /handleBlockUser/);
  assert.match(lectureDetail, /handleDeleteQuestion/);
  assert.match(lectureDetail, /handleDeleteAnswer/);
  assert.match(lectureDetail, /socket-qa-question-created/);
});

test("Prompt 8 introduces no runtime theme DOM mutation", () => {
  for (const source of [lectureList, lectureDetail, videoCard]) {
    assert.doesNotMatch(source, /dataset\.theme|style\.setProperty|location\.reload/);
  }
});

test("Prompt 17 scopes Reading Size to audited study text only", () => {
  assert.match(lectureDetail, /personalization-reading-question/);
  assert.match(lectureDetail, /personalization-reading-body/);
  assert.match(lectureDetail, /personalization-reading-fluid/);
  assert.doesNotMatch(lectureDetail, /data-app-reading-size|app_text_scale|text-size-adjust/);
});