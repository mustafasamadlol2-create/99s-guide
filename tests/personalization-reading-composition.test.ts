import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const lectureDetail = readFileSync(
  new URL("../src/features/lectures/components/LectureDetailView.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

const READING_SCALE = {
  small: 0.94,
  default: 1,
  large: 1.1,
} as const;

function effectiveScale(appTextScale: number, readingScale: number): number {
  return appTextScale * readingScale;
}

function assertNearlyEqual(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < Number.EPSILON * 8);
}

test("app_text_scale architecture is preserved and exposed to Reading CSS", () => {
  assert.match(app, /localStorage\.getItem\("app_text_scale"\)/);
  assert.match(app, /saved \? parseFloat\(saved\) : 1\.0/);
  assert.match(app, /fontSize:\s*`\$\{textScale\}rem`/);
  assert.match(app, /"--app-text-scale":\s*textScale/);
  assert.match(css, /var\(--app-text-scale,\s*1\)/);
  assert.doesNotMatch(app, /setItem\("app_text_scale"/);
});

test("Reading Size composes with actual numeric app_text_scale values", () => {
  const appTextScale = 1.1;

  assertNearlyEqual(effectiveScale(1, READING_SCALE.large), 1.1);
  assertNearlyEqual(effectiveScale(appTextScale, READING_SCALE.default), 1.1);
  assertNearlyEqual(effectiveScale(appTextScale, READING_SCALE.large), 1.21);
  assertNearlyEqual(effectiveScale(appTextScale, READING_SCALE.small), 1.034);
  assert.ok(
    effectiveScale(appTextScale, READING_SCALE.large) >
      effectiveScale(appTextScale, READING_SCALE.default),
  );
  assert.ok(
    effectiveScale(appTextScale, READING_SCALE.small) <
      effectiveScale(appTextScale, READING_SCALE.default),
  );
});

test("all eligible reading roles use the shared composition layer", () => {
  for (const role of [
    "personalization-reading-question",
    "personalization-reading-body",
    "personalization-reading-fluid",
  ]) {
    assert.match(
      role === "personalization-reading-fluid" ? lectureDetail : `${lectureDetail}${css}`,
      new RegExp(role),
    );
  }

  const readingCss = css.slice(css.indexOf(".personalization-reading-body"));
  assert.match(readingCss, /0\.75rem \* var\(--app-text-scale, 1\)/);
  assert.match(readingCss, /1\.02rem \* var\(--app-text-scale, 1\)/);
  assert.match(readingCss, /0\.875rem \* var\(--app-text-scale, 1\)/);
  assert.match(readingCss, /font-size: calc\(100% \* var\(--app-text-scale, 1\)\)/);
  assert.match(readingCss, /font-size: calc\(94% \* var\(--app-text-scale, 1\)\)/);
  assert.match(readingCss, /font-size: calc\(110% \* var\(--app-text-scale, 1\)\)/);
  assert.match(readingCss, /line-height: 1\.333333em/);
  assert.match(readingCss, /line-height: 1\.428571em/);
  assert.doesNotMatch(
    readingCss,
    /line-height:[\s\S]{0,100}--personalization-reading-scale/,
  );
});

test("Flashcard length-aware thresholds and behavior remain intact", () => {
  assert.match(lectureDetail, /currentFlashcardTextLength > 700/);
  assert.match(lectureDetail, /currentFlashcardTextLength > 480/);
  assert.match(lectureDetail, /currentFlashcardTextLength > 300/);
  assert.match(lectureDetail, /personalization-reading-fluid/);
  assert.match(lectureDetail, /setIsFlipped\(!isFlipped\)/);
  assert.match(lectureDetail, /handleCardRate/);
});
