import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  FIXED_SEMANTIC_TOKEN_NAMES,
  IMPLEMENTED_THEME_IDS,
  THEMEABLE_TOKEN_NAMES,
} from "../src/features/personalization/classic99Tokens.js";
import {
  PERSONALIZATION_THEME_IDS,
  type ThemeId,
} from "../shared/personalization.js";
import {
  getPersonalizationThemeAttribute,
  resolveVisualThemeId,
} from "../src/features/personalization/personalizationTheme.js";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const alternateThemeIds = IMPLEMENTED_THEME_IDS.filter(
  (themeId): themeId is Exclude<ThemeId, "classic-99"> =>
    themeId !== "classic-99",
);

function block(selector: string): string {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, selector);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

function declarations(source: string): Record<string, string> {
  return Object.fromEntries(
    [...source.matchAll(/--(semantic-[a-z-]+)\s*:\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].trim(),
    ]),
  );
}

function parseColor(value: string): [number, number, number, number] {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("#")) {
    let hex = normalized.slice(1);
    if (hex.length === 3) {
      hex = hex.split("").map((digit) => `${digit}${digit}`).join("");
    }
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
      1,
    ];
  }

  const match = normalized.match(/rgba?\(([^)]+)\)/);
  assert.ok(match, `Unsupported color value: ${value}`);
  const parts = match[1].split(",").map((part) => part.trim());
  return [
    Number(parts[0]),
    Number(parts[1]),
    Number(parts[2]),
    parts[3] === undefined ? 1 : Number(parts[3]),
  ];
}

function composite(
  foreground: [number, number, number, number],
  background: [number, number, number, number],
): [number, number, number, number] {
  const alpha = foreground[3];
  return [
    foreground[0] * alpha + background[0] * (1 - alpha),
    foreground[1] * alpha + background[1] * (1 - alpha),
    foreground[2] * alpha + background[2] * (1 - alpha),
    1,
  ];
}

function luminance(color: [number, number, number, number]): number {
  const channels = color.slice(0, 3).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return (
    channels[0] * 0.2126 +
    channels[1] * 0.7152 +
    channels[2] * 0.0722
  );
}

function contrastRatio(
  foreground: [number, number, number, number],
  background: [number, number, number, number],
): number {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

function textOn(
  text: string,
  surface: string,
  surfaceBase: string,
): number {
  const base = parseColor(surfaceBase);
  const effectiveSurface = composite(parseColor(surface), base);
  return contrastRatio(composite(parseColor(text), effectiveSurface), effectiveSurface);
}

test("implemented theme metadata exactly matches the shared eight-ID contract", () => {
  assert.deepEqual(IMPLEMENTED_THEME_IDS, PERSONALIZATION_THEME_IDS);
  assert.deepEqual(alternateThemeIds, [
    "midnight",
    "ocean",
    "emerald",
    "rose",
    "amber",
    "violet",
    "monochrome",
  ]);
});

test("every alternate theme defines exactly all 29 Light and Dark tokens", () => {
  const expectedNames = [...THEMEABLE_TOKEN_NAMES].sort();

  for (const themeId of alternateThemeIds) {
    const light = declarations(block(`:root[data-app-theme="${themeId}"]`));
    const dark = declarations(block(`.dark[data-app-theme="${themeId}"]`));

    assert.deepEqual(Object.keys(light).sort(), expectedNames, `${themeId} Light`);
    assert.deepEqual(Object.keys(dark).sort(), expectedNames, `${themeId} Dark`);
    assert.equal(Object.keys(light).length, 29, `${themeId} Light count`);
    assert.equal(Object.keys(dark).length, 29, `${themeId} Dark count`);

    for (const tokenName of FIXED_SEMANTIC_TOKEN_NAMES) {
      assert.equal(light[tokenName], undefined, `${themeId} Light fixed token`);
      assert.equal(dark[tokenName], undefined, `${themeId} Dark fixed token`);
    }
  }
});

test("alternate theme selectors are exact, feature-free, and do not use !important", () => {
  for (const themeId of alternateThemeIds) {
    const lightSelector = `:root[data-app-theme="${themeId}"]`;
    const darkSelector = `.dark[data-app-theme="${themeId}"]`;
    const escapeRegExp = (value: string) =>
      value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.equal(
      (css.match(new RegExp(`${escapeRegExp(lightSelector)}\\s*\\{`, "g")) ?? [])
        .length,
      1,
    );
    assert.equal(
      (css.match(new RegExp(`${escapeRegExp(darkSelector)}\\s*\\{`, "g")) ?? [])
        .length,
      1,
    );

    const themeCss = `${block(lightSelector)}\n${block(darkSelector)}`;
    assert.doesNotMatch(themeCss, /!important/);
    assert.doesNotMatch(
      themeCss,
      /\.(?:calendar|mcq|flashcard|lecture|module|sidebar|settings|profile|notification|home)\b/i,
    );
  }
});

test("complete Light and Dark palettes are unique", () => {
  const signatures = new Set<string>();
  for (const themeId of alternateThemeIds) {
    const light = declarations(block(`:root[data-app-theme="${themeId}"]`));
    const dark = declarations(block(`.dark[data-app-theme="${themeId}"]`));
    const signature = JSON.stringify([light, dark]);
    assert.equal(signatures.has(signature), false, `${themeId} duplicates another theme`);
    signatures.add(signature);
  }
  assert.equal(signatures.size, alternateThemeIds.length);
});

test("all eight theme IDs resolve to exact attributes while Classic removes the attribute", () => {
  assert.equal(getPersonalizationThemeAttribute("classic-99"), null);
  for (const themeId of alternateThemeIds) {
    assert.equal(resolveVisualThemeId(themeId), themeId);
    assert.equal(getPersonalizationThemeAttribute(themeId), themeId);
  }
  assert.equal(resolveVisualThemeId("unsupported-runtime-value"), "classic-99");
  assert.equal(getPersonalizationThemeAttribute("unsupported-runtime-value"), null);
});

test("all alternate themes meet the reusable normal-text contrast checks", () => {
  for (const themeId of alternateThemeIds) {
    const light = declarations(block(`:root[data-app-theme="${themeId}"]`));
    const dark = declarations(block(`.dark[data-app-theme="${themeId}"]`));
    const pairs = [
      ["content-primary/page", "semantic-content-primary", "semantic-background-page", "semantic-background-page"],
      ["content-primary/elevated", "semantic-content-primary", "semantic-surface-elevated", "semantic-surface-elevated"],
      ["content-secondary/elevated", "semantic-content-secondary", "semantic-surface-elevated", "semantic-surface-elevated"],
      ["chrome-primary/active", "semantic-chrome-content-primary", "semantic-chrome-surface-active", "semantic-surface-elevated"],
      ["active-foreground/active", "semantic-navigation-active-foreground", "semantic-navigation-active-background", "semantic-surface-elevated"],
      ["accent/elevated", "semantic-action-accent", "semantic-surface-elevated", "semantic-surface-elevated"],
      ["accent/page", "semantic-action-accent", "semantic-background-page", "semantic-background-page"],
    ] as const;

    for (const [name, text, surface, base] of pairs) {
      const lightRatio = textOn(light[text], light[surface], light[base]);
      const darkRatio = textOn(dark[text], dark[surface], dark[base]);
      assert.ok(lightRatio >= 4.5, `${themeId} Light ${name}: ${lightRatio.toFixed(2)}`);
      assert.ok(darkRatio >= 4.5, `${themeId} Dark ${name}: ${darkRatio.toFixed(2)}`);
    }
  }
});