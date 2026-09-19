import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const home = readFileSync(
  new URL("../src/features/home/components/HomeDashboard.tsx", import.meta.url),
  "utf8",
);
const lecture = readFileSync(
  new URL("../src/features/lectures/components/LectureDetailView.tsx", import.meta.url),
  "utf8",
);
const studio = readFileSync(
  new URL("../src/features/personalization/components/My99Studio.tsx", import.meta.url),
  "utf8",
);

test("R2 Hero styles change composition without taking Theme Pack color ownership", () => {
  for (const style of ["minimal", "night", "aurora"]) {
    assert.match(css, new RegExp(`data-app-hero-style="${style}"`));
    assert.match(css, new RegExp(`data-personalization-preview-hero-style="${style}"`));
  }
  assert.match(css, /minimal[\s\S]*box-shadow:/);
  assert.match(css, /night[\s\S]*filter: contrast\(1\.08\)/);
  assert.match(css, /aurora[\s\S]*mix-blend-mode: screen/);
  assert.match(css, /var\(--semantic-hero-glow-primary\)/);
  assert.doesNotMatch(css, /data-app-hero-style="aurora"[\s\S]{0,500}#(?:[0-9a-f]{3,8})/i);
});

test("R2 Glass styles cover eligible floating, search, lecture, and preview chrome", () => {
  assert.match(lecture, /lecture-detail-header liquid-glass-header/);
  assert.match(css, /cp-mobile-search-sheet/);
  for (const style of ["clear", "frosted"]) {
    assert.match(css, new RegExp(`data-app-glass-style="${style}"`));
    assert.match(css, new RegExp(`data-personalization-preview-glass-style="${style}"`));
  }
  assert.match(css, /prefers-reduced-transparency: reduce/);
  assert.match(css, /cp-mobile-search-sheet[\s\S]*background-color: #f2f2f7 !important/);
});

test("R2 Motion styles cover shared surfaces and user Reduced pauses StarField", () => {
  assert.match(css, /--personalization-motion-duration-factor/);
  for (const selector of [
    "my99-theme-card",
    "ios-tabbar-item",
    "ios-floating-tabbar-cluster",
    "ios-floating-search-button",
    "animate-fadeIn",
    "ios-staggered-card",
  ]) {
    assert.match(css, new RegExp(selector));
  }
  assert.match(home, /data-app-motion-style"\) === "reduced"/);
  assert.match(home, /userReducedMotion/);
  assert.match(home, /cancelAnimationFrame\(animationFrameId\)/);
  assert.match(home, /attributeFilter: \["data-app-theme", "data-app-motion-style"\]/);
  const osReducedStart = css.lastIndexOf("@media (prefers-reduced-motion: reduce)");
  assert.match(css.slice(osReducedStart), /animation:\s*none\s*!important/);
  assert.doesNotMatch(css.slice(osReducedStart), /animation-play-state:\s*running/);
});

test("R2 Reading Size scales ordinary semantic typography and composes with app_text_scale", () => {
  assert.match(css, /--personalization-effective-reading-scale:\s*calc\(var\(--app-text-scale, 1\) \* var\(--personalization-reading-scale, 1\)\)/);
  for (const token of [
    "--text-body",
    "--text-subhead",
    "--text-footnote",
    "--text-caption-1",
    "--text-sm",
    "--text-base",
    "--text-lg",
  ]) {
    assert.match(css, new RegExp(`${token}:`));
  }
  assert.match(css, /--text-body: calc\(1\.0625rem \* var\(--personalization-effective-reading-scale\)\)/);
  assert.match(css, /\.personalization-reading-home-title/);
  assert.match(home, /personalization-reading-home-title/);
  assert.doesNotMatch(home, /titleClass:[\s\S]{0,120}text-\[(?:2rem|2\.5rem)\]/);
  const readingStart = css.indexOf("/* Reading Size scales semantic typography");
  const readingEnd = css.indexOf("/* OS reduced motion is", readingStart);
  assert.ok(readingStart > 0 && readingEnd > readingStart);
  assert.doesNotMatch(
    css.slice(readingStart, readingEnd),
    /html\s*\{[^}]*font-size|transform:\s*scale|zoom:/,
  );
});

test("R2 preview changes remain attribute-scoped and do not become persistence paths", () => {
  for (const axis of ["hero-style", "glass-style", "motion-style", "reading-size"]) {
    assert.match(studio, new RegExp(`data-personalization-preview-${axis}=\\{draft\\.`));
  }
  assert.doesNotMatch(studio, /localStorage\.(?:setItem|removeItem)/);
  assert.doesNotMatch(studio, /fetch\([^)]*PUT|method:\s*["']PUT["']/);
  assert.doesNotMatch(
    css.slice(css.lastIndexOf("R2 — functional presentation axes")),
    /document\.(?:documentElement|body)\.(?:style|classList)|setAttribute\(["']data-app-/,
  );
});