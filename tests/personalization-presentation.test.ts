import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PERSONALIZATION_GLASS_STYLES,
  PERSONALIZATION_HERO_STYLES,
  PERSONALIZATION_MOTION_STYLES,
  PERSONALIZATION_READING_SIZES,
} from "../shared/personalization.js";
import {
  PERSONALIZATION_GLASS_CATALOG,
  PERSONALIZATION_HERO_CATALOG,
  PERSONALIZATION_MOTION_CATALOG,
  PERSONALIZATION_READING_CATALOG,
} from "../src/features/personalization/personalizationCatalog.js";
import {
  synchronizePersonalizationPresentation,
} from "../src/features/personalization/personalizationPresentation.js";

function makeTarget(initial: Record<string, string> = {}) {
  const attributes = new Map(Object.entries(initial));
  const calls: string[] = [];
  return {
    calls,
    target: {
      hasAttribute: (name: string) => attributes.has(name),
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => {
        attributes.set(name, value);
        calls.push(`set:${name}=${value}`);
      },
      removeAttribute: (name: string) => {
        attributes.delete(name);
        calls.push(`remove:${name}`);
      },
    },
    value: (name: string) => attributes.get(name) ?? null,
  };
}

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const bridge = readFileSync(
  new URL(
    "../src/features/personalization/PersonalizationPresentationBridge.tsx",
    import.meta.url,
  ),
  "utf8",
);
const studio = readFileSync(
  new URL("../src/features/personalization/components/My99Studio.tsx", import.meta.url),
  "utf8",
);
const translations = readFileSync(
  new URL("../src/core/i18n/translations.ts", import.meta.url),
  "utf8",
);

test("presentation catalogs preserve the canonical runtime orders", () => {
  assert.deepEqual(
    PERSONALIZATION_HERO_CATALOG.map(({ id }) => id),
    [...PERSONALIZATION_HERO_STYLES],
  );
  assert.deepEqual(
    PERSONALIZATION_GLASS_CATALOG.map(({ id }) => id),
    [...PERSONALIZATION_GLASS_STYLES],
  );
  assert.deepEqual(
    PERSONALIZATION_MOTION_CATALOG.map(({ id }) => id),
    [...PERSONALIZATION_MOTION_STYLES],
  );
  assert.deepEqual(
    PERSONALIZATION_READING_CATALOG.map(({ id }) => id),
    [...PERSONALIZATION_READING_SIZES],
  );
});

test("Classic and Balanced defaults remove optional runtime attributes", () => {
  const target = makeTarget({
    "data-app-hero-style": "aurora",
    "data-app-glass-style": "frosted",
  });

  synchronizePersonalizationPresentation(
    target.target as unknown as HTMLElement,
    "classic",
    "balanced",
  );
  synchronizePersonalizationPresentation(
    target.target as unknown as HTMLElement,
    "invalid",
    "invalid",
  );

  assert.deepEqual(target.calls, [
    "remove:data-app-hero-style",
    "remove:data-app-glass-style",
  ]);
  assert.equal(target.value("data-app-hero-style"), null);
  assert.equal(target.value("data-app-glass-style"), null);
});

test("alternate runtime attributes are strict, idempotent, and transition independently", () => {
  const target = makeTarget();
  const element = target.target as unknown as HTMLElement;

  synchronizePersonalizationPresentation(element, "minimal", "clear");
  synchronizePersonalizationPresentation(element, "minimal", "clear");
  synchronizePersonalizationPresentation(element, "night", "clear");
  synchronizePersonalizationPresentation(element, "night", "frosted");

  assert.deepEqual(target.calls, [
    "set:data-app-hero-style=minimal",
    "set:data-app-glass-style=clear",
    "set:data-app-hero-style=night",
    "set:data-app-glass-style=frosted",
  ]);
  assert.equal(target.value("data-app-hero-style"), "night");
  assert.equal(target.value("data-app-glass-style"), "frosted");
});

test("Motion and Reading defaults remove optional attributes and alternates are committed-only", () => {
  const target = makeTarget({
    "data-app-motion-style": "reduced",
    "data-app-reading-size": "large",
  });
  const element = target.target as unknown as HTMLElement;

  synchronizePersonalizationPresentation(element, "classic", "balanced", "full", "default");
  assert.deepEqual(target.calls, [
    "remove:data-app-motion-style",
    "remove:data-app-reading-size",
  ]);
  assert.equal(target.value("data-app-motion-style"), null);
  assert.equal(target.value("data-app-reading-size"), null);

  synchronizePersonalizationPresentation(element, "classic", "balanced", "subtle", "large");
  synchronizePersonalizationPresentation(element, "classic", "balanced", "reduced", "small");
  synchronizePersonalizationPresentation(element, "classic", "balanced", "invalid", "invalid");

  assert.deepEqual(target.calls, [
    "remove:data-app-motion-style",
    "remove:data-app-reading-size",
    "set:data-app-motion-style=subtle",
    "set:data-app-reading-size=large",
    "set:data-app-motion-style=reduced",
    "set:data-app-reading-size=small",
    "remove:data-app-motion-style",
    "remove:data-app-reading-size",
  ]);
});

test("the runtime bridge reads committed state and the preview owns all three axes", () => {
  assert.match(bridge, /const \{ committed \} = usePersonalization\(\)/);
  assert.doesNotMatch(bridge, /\bdraft\b/);
  assert.match(css, /data-personalization-preview-theme/);
  assert.match(css, /data-personalization-preview-hero-style/);
  assert.match(css, /data-personalization-preview-glass-style/);
  assert.match(css, /data-personalization-preview-motion-style/);
  assert.match(css, /data-personalization-preview-reading-size/);
  assert.match(bridge, /committed\.motionStyle/);
  assert.match(bridge, /committed\.readingSize/);
  assert.match(css, /--semantic-hero-glow-primary/);
  assert.match(css, /--semantic-glass-surface/);
  assert.doesNotMatch(
    css,
    /data-app-theme="[^"]+"\][^{]*data-app-(?:hero|glass)-style/,
  );
});

test("OS reduced motion remains the final accessibility precedence layer", () => {
  const osReducedStart = css.lastIndexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(osReducedStart > 0);
  const osReducedSource = css.slice(osReducedStart);
  assert.match(osReducedSource, /animation:\s*none\s*!important/);
  assert.match(osReducedSource, /animation-play-state:\s*paused\s*!important/);
  assert.doesNotMatch(osReducedSource, /animation-play-state:\s*running/);
});

test("Balanced Glass and Classic Hero defaults retain the audited production baselines", () => {
  assert.match(css, /--semantic-hero-background:\s*#05070b;/);
  assert.match(css, /--semantic-hero-glow-primary:\s*rgba\(30, 58, 110, 0\.52\);/);
  assert.match(css, /--semantic-hero-glow-secondary:\s*rgba\(180, 120, 30, 0\.26\);/);
  assert.match(css, /--personalization-hero-star-opacity:\s*0\.48;/);
  assert.match(css, /--personalization-hero-overlay-opacity:\s*0\.9;/);
  assert.match(css, /--personalization-glass-tabbar-blur:\s*32px;/);
  assert.match(css, /--personalization-glass-tabbar-saturation:\s*1\.45;/);
  assert.match(css, /--personalization-glass-regular-blur:\s*12px;/);
  assert.match(css, /background-color: var\(--personalization-glass-regular-surface\) !important;/);
  assert.match(css, /backdrop-filter: blur\(var\(--personalization-glass-regular-blur\)\) !important;/);
});

test("Clear and Frosted Glass use semantic fallbacks with guarded modern enhancements", () => {
  const supportStart = css.indexOf(
    "@supports (color: color-mix(in srgb, black, white))",
  );
  const supportEnd = css.indexOf("/* A local Balanced preview", supportStart);
  assert.ok(supportStart > 0);
  assert.ok(supportEnd > supportStart);

  const fallbackSource = css.slice(
    css.indexOf(':root[data-app-glass-style="clear"]'),
    supportStart,
  );
  const enhancementSource = css.slice(supportStart, supportEnd);
  assert.doesNotMatch(fallbackSource, /color-mix\(/);
  assert.match(
    fallbackSource,
    /--personalization-glass-regular-surface:\s*var\(--semantic-glass-surface\);/,
  );
  assert.match(
    fallbackSource,
    /--personalization-glass-regular-border:\s*var\(--semantic-glass-border\);/,
  );
  assert.match(
    fallbackSource,
    /:root\[data-app-glass-style="frosted"\][\s\S]*--personalization-glass-thin-surface:\s*var\(--semantic-glass-surface\);/,
  );
  assert.match(
    fallbackSource,
    /:root\[data-app-glass-style="frosted"\][\s\S]*--personalization-glass-header-border:\s*var\(--semantic-glass-border\);/,
  );
  assert.equal((enhancementSource.match(/color-mix\(/g) ?? []).length, 19);
  assert.match(enhancementSource, /data-personalization-preview-glass-style="clear"/);
  assert.match(enhancementSource, /data-personalization-preview-glass-style="frosted"/);
});

test("unsupported color-mix capability leaves valid Glass and preview declarations", () => {
  const supportStart = css.indexOf(
    "@supports (color: color-mix(in srgb, black, white))",
  );
  const supportEnd = css.indexOf("/* A local Balanced preview", supportStart);
  const unsupportedSource = css.slice(0, supportStart) + css.slice(supportEnd);

  assert.doesNotMatch(unsupportedSource, /color-mix\(/);
  for (const variable of [
    "thin-surface",
    "regular-surface",
    "thick-surface",
    "tabbar-surface",
    "header-surface",
  ]) {
    assert.match(
      unsupportedSource,
      new RegExp(
        `--personalization-glass-${variable}:\\s*var\\(--semantic-glass-surface\\);`,
      ),
    );
  }
  for (const variable of [
    "thin-border",
    "regular-border",
    "thick-border",
    "tabbar-border",
    "header-border",
  ]) {
    assert.match(
      unsupportedSource,
      new RegExp(
        `--personalization-glass-${variable}:\\s*var\\(--semantic-glass-border\\);`,
      ),
    );
  }
  assert.match(unsupportedSource, /--personalization-glass-regular-blur:\s*7px;/);
  assert.match(unsupportedSource, /--personalization-glass-regular-blur:\s*18px;/);
  assert.match(
    unsupportedSource,
    /\.personalization-glass-specimen[\s\S]*background-color: var\(--personalization-glass-regular-surface\);/,
  );
  assert.match(
    unsupportedSource,
    /\.my99-glass-mini-preview-surface[\s\S]*background: var\(--personalization-glass-regular-surface\);/,
  );
});

test("Glass compatibility keeps accessibility and mobile cascade precedence", () => {
  const supportStart = css.indexOf(
    "@supports (color: color-mix(in srgb, black, white))",
  );
  const mobileStart = css.indexOf("@media (hover: none) and (pointer: coarse)");
  const reducedStart = css.lastIndexOf(
    "@media (prefers-reduced-transparency: reduce)",
  );
  const forcedColorsStart = css.lastIndexOf("@media (forced-colors: active)");

  assert.ok(mobileStart > 0 && mobileStart < supportStart);
  assert.ok(reducedStart > supportStart);
  assert.ok(forcedColorsStart > supportStart);
  assert.doesNotMatch(
    css.slice(supportStart, css.indexOf("/* A local Balanced preview", supportStart)),
    /tabbar-mobile-blur|header-mobile-blur/,
  );
  assert.match(
    css.slice(reducedStart),
    /backdrop-filter:\s*none\s*!important;[\s\S]*background-color:\s*#f2f2f7\s*!important;/,
  );
  assert.match(
    css.slice(forcedColorsStart),
    /forced-color-adjust:\s*auto;/,
  );
});

test("Studio exposes five localized single-choice groups without future placeholders", () => {
  assert.equal((studio.match(/role="radiogroup"/g) ?? []).length, 5);
  assert.match(studio, /data-personalization-preview-hero-style=\{draft\.heroStyle\}/);
  assert.match(studio, /data-personalization-preview-glass-style=\{draft\.glassStyle\}/);
  assert.match(studio, /data-personalization-preview-motion-style=\{draft\.motionStyle\}/);
  assert.match(studio, /data-personalization-preview-reading-size=\{draft\.readingSize\}/);
  for (const key of [
    "my99HeroStyleTitle",
    "my99HeroStyleDescription",
    "my99HeroClassicName",
    "my99HeroMinimalName",
    "my99HeroNightName",
    "my99HeroAuroraName",
    "my99GlassStyleTitle",
    "my99GlassStyleDescription",
    "my99GlassClearName",
    "my99GlassBalancedName",
    "my99GlassFrostedName",
    "my99MotionStyleTitle",
    "my99MotionStyleDescription",
    "my99MotionFullName",
    "my99MotionSubtleName",
    "my99MotionReducedName",
    "my99ReadingSizeTitle",
    "my99ReadingSizeDescription",
    "my99ReadingSmallName",
    "my99ReadingDefaultName",
    "my99ReadingLargeName",
  ]) {
    assert.equal(
      (translations.match(new RegExp(`\\b${key}:`, "g")) ?? []).length,
      2,
      `${key} should be present in English and Arabic`,
    );
  }
  assert.doesNotMatch(studio, /Home Order|App Icon|Coming Soon/);
});