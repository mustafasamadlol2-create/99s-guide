import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  FIXED_SEMANTIC_TOKEN_NAMES,
  IMPLEMENTED_THEME_IDS,
  THEMEABLE_TOKEN_NAMES,
} from "../src/features/personalization/classic99Tokens.js";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const semanticCss = (css.match(
  /--(?:color-)?semantic-[a-z-]+\s*:[^;]+;/g,
) ?? []).join("\n");

test("Classic 99 is the only visually implemented theme", () => {
  assert.deepEqual(IMPLEMENTED_THEME_IDS, ["classic-99"]);
  for (const futureThemeId of [
    "midnight",
    "ocean",
    "emerald",
    "rose",
    "amber",
    "violet",
    "monochrome",
  ]) {
    assert.equal(semanticCss.includes(futureThemeId), false);
  }
});

test("themeable token names are unique and have light/dark CSS declarations", () => {
  assert.equal(
    new Set(THEMEABLE_TOKEN_NAMES).size,
    THEMEABLE_TOKEN_NAMES.length,
  );

  for (const tokenName of THEMEABLE_TOKEN_NAMES) {
    const declarationCount = css.match(
      new RegExp(`--${tokenName}:`, "g"),
    )?.length ?? 0;
    assert.equal(declarationCount, 2, tokenName);
  }
});

test("fixed semantic tokens are independent of appearance tokens", () => {
  assert.equal(
    new Set(FIXED_SEMANTIC_TOKEN_NAMES).size,
    FIXED_SEMANTIC_TOKEN_NAMES.length,
  );

  const expectedValues = {
    "status-error": "#ff3b30",
    "status-success": "#34c759",
    "status-warning": "#ff9500",
    "status-offline": "#8e8e93",
    "status-online": "#34c759",
    "action-destructive": "#ff3b30",
    "validation-error": "#ff3b30",
  } as const;

  for (const [tokenName, value] of Object.entries(expectedValues)) {
    assert.match(css, new RegExp(`--${tokenName}:\\s*${value}`));
    assert.equal(css.match(new RegExp(`--${tokenName}:`, "g"))?.length, 1);
  }
});

test("dedicated Tailwind aliases do not redefine standard palette names", () => {
  for (const tokenName of THEMEABLE_TOKEN_NAMES) {
    assert.match(css, new RegExp(`--color-${tokenName}:`));
  }

  for (const paletteName of [
    "red",
    "green",
    "blue",
    "amber",
    "orange",
    "rose",
    "emerald",
    "violet",
    "slate",
  ]) {
    assert.doesNotMatch(css, new RegExp(`--color-${paletteName}:`));
  }
});

test("centralized existing surface and shadow roles remain the parity sources", () => {
  assert.match(css, /--semantic-surface-primary:\s*#fbfbfd/);
  assert.match(css, /--semantic-surface-elevated:\s*#ffffff/);
  assert.match(css, /--semantic-surface-muted:\s*#e5e5ea/);
  assert.match(css, /--semantic-shadow-generic:\s*var\(--shadow-elevation-1\)/);
  assert.match(css, /\.dark\s*\{[\s\S]*--semantic-surface-primary:\s*#000000/);
  assert.match(css, /\.dark\s*\{[\s\S]*--semantic-shadow-generic:\s*var\(--shadow-elevation-1\)/);
});
