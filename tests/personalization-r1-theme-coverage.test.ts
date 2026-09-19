import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const app = read("src/App.tsx");
const hero = read("src/features/home/components/HomeDashboard.tsx");
const css = read("src/index.css");
const subject = read("src/features/subjects/components/SubjectView.tsx");
const lecture = read("src/features/lectures/components/LectureDetailView.tsx");
const themeBridge = read("src/features/personalization/PersonalizationThemeBridge.tsx");
const presentationBridge = read(
  "src/features/personalization/PersonalizationPresentationBridge.tsx",
);
const lifecycle = read(
  "src/features/personalization/personalizationDocumentLifecycle.ts",
);

test("R1 repairs reusable Subject and Module application surfaces", () => {
  assert.match(subject, /bg-semantic-background-page/);
  assert.match(subject, /bg-semantic-surface-elevated/);
  assert.match(subject, /text-semantic-navigation-tab-active/);
  assert.match(subject, /text-semantic-chrome-content-secondary/);
  assert.match(subject, /bg-semantic-chrome-surface-hover/);
  assert.match(subject, /border-semantic-border-default/);
  assert.doesNotMatch(subject, /subject-view-root[^`\n]*bg-neutral-50/);
  assert.doesNotMatch(subject, /baseCardClassName = `[^`]*bg-white/);
});

test("R1 repairs Lecture header, tabs, and lower application chrome", () => {
  assert.match(lecture, /bg-semantic-glass-surface/);
  assert.match(lecture, /border-semantic-glass-border/);
  assert.match(lecture, /bg-semantic-navigation-active-background/);
  assert.match(lecture, /text-semantic-navigation-active-foreground/);
  assert.match(lecture, /text-semantic-navigation-tab-inactive/);
  assert.match(lecture, /bg-semantic-surface-elevated/);
  assert.match(lecture, /bg-semantic-action-accent/);
  assert.match(lecture, /activeTab === "notes"/);
  assert.doesNotMatch(lecture, /lecture-tabbar[^"\n]*bg-black/);
});

test("R1 keeps fixed success/destructive semantics separate from themed chrome", () => {
  assert.match(lecture, /bg-emerald-500 hover:bg-emerald-600 text-white/);
  assert.match(lecture, /handleDeleteLecture/);
  assert.match(lecture, /text-rose-500 hover:text-rose-600/);
});

test("R1 repairs shared floating navigation without changing its behavior contract", () => {
  assert.match(app, /liquid-glass-tabbar relative px-2/);
  assert.match(app, /ios-floating-search-button liquid-glass-tabbar/);
  assert.match(app, /suspendSharedIndicatorMotion/);
  assert.match(css, /background:\s*var\(--semantic-navigation-active-background\)/);
  assert.match(css, /color:\s*var\(--semantic-navigation-tab-active\)/);
  assert.match(css, /border:\s*1px solid var\(--semantic-glass-border\)/);
  assert.match(css, /\.ios-floating-tabbar\.ios-tabbar-resting/);
  assert.match(css, /\.ios-floating-tabbar\.ios-tabbar-engaged/);
});

test("R1 makes Hero layers and particles consume semantic theme colors", () => {
  assert.match(hero, /bg-semantic-hero-background/);
  assert.match(hero, /var\(--semantic-hero-background\)/);
  assert.match(hero, /--semantic-hero-glow-primary/);
  assert.match(hero, /MutationObserver/);
  assert.match(hero, /particleColor/);
  assert.doesNotMatch(hero, /home-hero-primary-gradient[^"\n]*from-\[#/);
  assert.doesNotMatch(hero, /home-hero-secondary-gradient[^"\n]*from-\[#/);
  assert.match(css, /\.home-hero-primary-gradient/);
  assert.match(css, /\.home-hero-secondary-gradient/);
  assert.match(css, /var\(--semantic-hero-glow-primary\)/);
  assert.match(css, /var\(--semantic-hero-glow-secondary\)/);
  assert.match(css, /@supports \(color: color-mix\(in srgb, black, white\)\)/);
});

test("R1 preserves the committed theme and presentation attributes during hydration", () => {
  for (const bridge of [themeBridge, presentationBridge]) {
    assert.match(bridge, /shouldPreservePersonalizationDuringHydration/);
    assert.match(bridge, /hydration\.phase === "loading"/);
    assert.match(bridge, /appliedOwnerUserIdRef/);
    assert.match(bridge, /committed/);
    assert.doesNotMatch(bridge, /draft/);
  }
  assert.match(lifecycle, /previousOwnerUserId === activeUserId/);
  assert.match(themeBridge, /synchronizePersonalizationTheme/);
  assert.match(presentationBridge, /synchronizePersonalizationPresentation/);
});

test("R1 keeps cloud schema and out-of-scope axes untouched", () => {
  const config = read("shared/personalization.ts");
  const cloudApi = read("server/routes/personalization.ts");
  assert.match(config, /PersonalizationConfigV1/);
  assert.match(config, /PersonalizationLocalEnvelopeV2/);
  assert.doesNotMatch(hero, /hiddenSubjectIds|semester/);
  assert.doesNotMatch(config, /hiddenSubjectIds|semester/);
  assert.match(cloudApi, /personalization/);
});