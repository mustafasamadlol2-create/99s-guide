import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PERSONALIZATION_GLASS_STYLES,
  PERSONALIZATION_HERO_STYLES,
} from "../shared/personalization.js";
import {
  PERSONALIZATION_GLASS_CATALOG,
  PERSONALIZATION_HERO_CATALOG,
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

test("Hero and Glass catalogs preserve the canonical runtime orders", () => {
  assert.deepEqual(
    PERSONALIZATION_HERO_CATALOG.map(({ id }) => id),
    [...PERSONALIZATION_HERO_STYLES],
  );
  assert.deepEqual(
    PERSONALIZATION_GLASS_CATALOG.map(({ id }) => id),
    [...PERSONALIZATION_GLASS_STYLES],
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

test("the runtime bridge reads committed state and the preview owns all three axes", () => {
  assert.match(bridge, /const \{ committed \} = usePersonalization\(\)/);
  assert.doesNotMatch(bridge, /\bdraft\b/);
  assert.match(css, /data-personalization-preview-theme/);
  assert.match(css, /data-personalization-preview-hero-style/);
  assert.match(css, /data-personalization-preview-glass-style/);
  assert.match(css, /--semantic-hero-glow-primary/);
  assert.match(css, /--semantic-glass-surface/);
  assert.doesNotMatch(
    css,
    /data-app-theme="[^"]+"\][^{]*data-app-(?:hero|glass)-style/,
  );
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

test("Studio exposes three localized single-choice groups without future placeholders", () => {
  assert.equal((studio.match(/role="radiogroup"/g) ?? []).length, 3);
  assert.match(studio, /data-personalization-preview-hero-style=\{draft\.heroStyle\}/);
  assert.match(studio, /data-personalization-preview-glass-style=\{draft\.glassStyle\}/);
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
  ]) {
    assert.equal(
      (translations.match(new RegExp(`\\b${key}:`, "g")) ?? []).length,
      2,
      `${key} should be present in English and Arabic`,
    );
  }
  assert.doesNotMatch(studio, /Motion|Reading Size|Home Order|App Icon|Coming Soon/);
});