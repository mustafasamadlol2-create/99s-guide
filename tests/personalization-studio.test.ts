import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  IMPLEMENTED_THEME_IDS,
  THEMEABLE_TOKEN_NAMES,
} from "../src/features/personalization/classic99Tokens.js";
import { PERSONALIZATION_THEME_CATALOG } from "../src/features/personalization/personalizationCatalog.js";

const studio = readFileSync(
  new URL("../src/features/personalization/components/My99Studio.tsx", import.meta.url),
  "utf8",
);
const settings = readFileSync(
  new URL("../src/features/settings/components/SettingsView.tsx", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const translations = readFileSync(
  new URL("../src/core/i18n/translations.ts", import.meta.url),
  "utf8",
);
const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

test("My 99 catalog exposes exactly the canonical theme order and no palette values", () => {
  assert.deepEqual(
    PERSONALIZATION_THEME_CATALOG.map(({ id }) => id),
    [...IMPLEMENTED_THEME_IDS],
  );
  const catalogSource = readFileSync(
    new URL("../src/features/personalization/personalizationCatalog.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(catalogSource, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(catalogSource, /\b(?:rgb|hsl)a?\s*\(/i);
  assert.deepEqual(
    PERSONALIZATION_THEME_CATALOG.map(({ id }) => id),
    ["classic-99", "midnight", "ocean", "emerald", "rose", "amber", "violet", "monochrome"],
  );
});

test("My 99 uses provider state and contains no direct persistence or global theme mutation", () => {
  assert.match(studio, /usePersonalization\(\)/);
  for (const method of [
    "updateDraft",
    "applyDraft",
    "cancelDraft",
    "resetDraft",
  ]) {
    assert.match(studio, new RegExp(`\\b${method}\\b`));
  }
  assert.doesNotMatch(studio, /localStorage|personalizationStorage|Capacitor\.Preferences/);
  assert.doesNotMatch(studio, /setAttribute\(\s*["']data-app-theme|removeAttribute\(\s*["']data-app-theme/);
  assert.doesNotMatch(studio, /style\.setProperty/);
  assert.match(studio, /data-personalization-preview-theme/);
});

test("theme cards expose accessible single-selection semantics and all lifecycle actions", () => {
  assert.match(studio, /role="radio"/);
  assert.match(studio, /aria-checked=\{isDraft\}/);
  assert.match(studio, /role="radiogroup"/);
  assert.match(studio, /my99Apply/);
  assert.match(studio, /my99Cancel/);
  assert.match(studio, /my99Reset/);
  assert.match(studio, /disabled=\{!canApply\}/);
});

test("Settings places My 99 between system preferences and privacy", () => {
  const entry = settings.indexOf('t("my99EntryTitle")');
  const privacy = settings.indexOf('Privacy & Security');
  assert.ok(entry > 0);
  assert.ok(privacy > entry);
  assert.match(settings, /onOpenMy99\?\./);
  assert.match(app, /setActiveTab\("my99"\)/);
  assert.match(app, /<My99Studio/);
});

test("both locales contain every new My 99 user-visible key", () => {
  const keys = [
    "my99EntryTitle",
    "my99EntryDescription",
    "my99Title",
    "my99Description",
    "my99Back",
    "my99PreviewTitle",
    "my99PreviewDescription",
    "my99CurrentLabel",
    "my99DraftLabel",
    "my99ThemePacksTitle",
    "my99ThemePacksDescription",
    "my99Cancel",
    "my99Reset",
    "my99Apply",
    "my99Applying",
    ...PERSONALIZATION_THEME_CATALOG.flatMap(({ nameKey, descriptionKey }) => [
      nameKey,
      descriptionKey,
    ]),
  ];
  for (const key of keys) {
    assert.equal(
      (translations.match(new RegExp(`\\b${key}:`, "g")) ?? []).length,
      2,
      `${key} should be present in English and Arabic`,
    );
  }
});

test("every theme token block also scopes the contained preview attribute", () => {
  for (const themeId of IMPLEMENTED_THEME_IDS) {
    assert.match(
      css,
      new RegExp(
        `data-personalization-preview-theme="${themeId}"`,
      ),
    );
    for (const tokenName of THEMEABLE_TOKEN_NAMES) {
      assert.match(
        css,
        new RegExp(
          `data-personalization-preview-theme="${themeId}"[\\s\\S]*--${tokenName}\\s*:`,
        ),
      );
    }
  }
  assert.match(
    css,
    /:root,\s*\[data-personalization-preview-theme="classic-99"\]/,
  );
  assert.match(
    css,
    /\.dark,\s*\.dark \[data-personalization-preview-theme="classic-99"\]/,
  );
});