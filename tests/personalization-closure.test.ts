import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  IMPLEMENTED_THEME_IDS,
  THEMEABLE_TOKEN_NAMES,
} from "../src/features/personalization/classic99Tokens.js";
import {
  PERSONALIZATION_THEME_IDS,
  PERSONALIZATION_HERO_STYLES,
  PERSONALIZATION_GLASS_STYLES,
  PERSONALIZATION_MOTION_STYLES,
  PERSONALIZATION_READING_SIZES,
} from "../shared/personalization.js";

const workspaceRoot = new URL("../", import.meta.url).pathname;
const srcRoot = join(workspaceRoot, "src");
const css = readFileSync(join(srcRoot, "index.css"), "utf8");
const app = readFileSync(join(srcRoot, "App.tsx"), "utf8");
const provider = readFileSync(
  join(srcRoot, "features/personalization/PersonalizationProvider.tsx"),
  "utf8",
);
const moduleVisuals = readFileSync(
  join(srcRoot, "features/modules/moduleVisuals.ts"),
  "utf8",
);
const iosAlert = readFileSync(join(srcRoot, "core/layout/iOSAlert.tsx"), "utf8");
const themePreload = readFileSync(
  join(workspaceRoot, "public/theme-preload.js"),
  "utf8",
);

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|js)$/.test(entry.name) ? [path] : [];
  });
}

const runtimeSources = sourceFiles(srcRoot)
  .filter((path) => !path.includes("/features/personalization/"))
  .map((path) => ({
    path: relative(workspaceRoot, path),
    source: readFileSync(path, "utf8"),
  }));
const runtimeSourceText = runtimeSources.map(({ source }) => source).join("\n");

const futureThemeIds = PERSONALIZATION_THEME_IDS.filter(
  (themeId) => themeId !== "classic-99",
);

test("Classic 99 is the only visual theme implementation and future IDs have no selectors", () => {
  assert.deepEqual(IMPLEMENTED_THEME_IDS, ["classic-99"]);
  assert.deepEqual(
    futureThemeIds,
    ["midnight", "ocean", "emerald", "rose", "amber", "violet", "monochrome"],
  );

  const semanticCss = css.match(
    /--(?:color-)?semantic-[a-z-]+\s*:[^;]+;/g,
  )?.join("\n") ?? "";
  for (const futureThemeId of futureThemeIds) {
    assert.doesNotMatch(semanticCss, new RegExp(futureThemeId));
    assert.doesNotMatch(
      runtimeSourceText,
      new RegExp(`(?:data-theme|theme-${futureThemeId}|--${futureThemeId}-)`),
    );
  }
});

test("future ThemeIds remain visually inert outside personalization state", () => {
  assert.match(app, /bg-semantic-background-page/);
  assert.match(app, /text-semantic-content-primary/);
  assert.doesNotMatch(runtimeSourceText, /\bthemeId\b/);
  assert.doesNotMatch(runtimeSourceText, /data-theme/);
  assert.doesNotMatch(runtimeSourceText, /key\s*=\s*\{[^}]*themeId/);
  assert.doesNotMatch(runtimeSourceText, /style\.setProperty\([^)]*theme/i);
  assert.doesNotMatch(runtimeSourceText, /style\.setProperty\([^)]*--semantic-/);
  assert.doesNotMatch(runtimeSourceText, /location\.reload\([^)]*theme/i);
  assert.doesNotMatch(provider, /className|data-theme|style\.setProperty|key=/);
});

test("appearance storage remains separate from the unwired personalization contract", () => {
  assert.match(app, /localStorage\.getItem\("app_theme"\)/);
  assert.match(app, /localStorage\.setItem\("app_theme"/);
  assert.match(app, /localStorage\.getItem\("app_text_scale"\)/);
  assert.match(themePreload, /localStorage\.getItem\("app_theme"\)/);
  assert.doesNotMatch(app, /themeId|readingSize|heroStyle|glassStyle|motionStyle|subjectOrder/);
  assert.doesNotMatch(themePreload, /themeId|Personalization|semantic-/);
  assert.equal(runtimeSourceText.includes("usePersonalization("), false);
});

test("personalization contract retains future values without creating visual palettes", () => {
  assert.deepEqual(PERSONALIZATION_HERO_STYLES, ["classic", "minimal", "night", "aurora"]);
  assert.deepEqual(PERSONALIZATION_GLASS_STYLES, ["clear", "balanced", "frosted"]);
  assert.deepEqual(PERSONALIZATION_MOTION_STYLES, ["full", "subtle", "reduced"]);
  assert.deepEqual(PERSONALIZATION_READING_SIZES, ["small", "default", "large"]);
  assert.match(provider, /PersonalizationProvider/);
  assert.match(css, /--semantic-glass-surface/);
  assert.match(css, /--semantic-hero-background/);
  assert.equal(THEMEABLE_TOKEN_NAMES.includes("semantic-glass-surface"), true);
  assert.equal(THEMEABLE_TOKEN_NAMES.includes("semantic-hero-background"), true);
});

test("fixed status roles are not derived from the themeable action accent", () => {
  const fixedLayer = css.slice(css.indexOf("--status-error:"), css.indexOf("\n}", css.indexOf("--status-error:")));
  assert.match(fixedLayer, /--status-error:\s*#ff3b30/);
  assert.match(fixedLayer, /--status-success:\s*#34c759/);
  assert.match(fixedLayer, /--status-warning:\s*#ff9500/);
  assert.match(fixedLayer, /--status-offline:\s*#8e8e93/);
  assert.match(fixedLayer, /--status-online:\s*#34c759/);
  assert.match(fixedLayer, /--action-destructive:\s*#ff3b30/);
  assert.match(fixedLayer, /--validation-error:\s*#ff3b30/);
  assert.doesNotMatch(fixedLayer, /var\(--semantic-action-accent\)|var\(--semantic-navigation/);
  assert.match(iosAlert, /isDestructive/);
  assert.match(iosAlert, /text-med-error dark:text-red-400/);
});

test("module identity remains independent from theme tokens", () => {
  for (const subjectId of ["CA", "ID", "RM", "NT", "ImD", "PHC", "SSC"]) {
    assert.match(moduleVisuals, new RegExp(`\\b${subjectId}:\\s*\\{`));
  }
  assert.match(moduleVisuals, /MODULE_ORDER/);
  assert.match(moduleVisuals, /accent:/);
  assert.match(moduleVisuals, /surfaceClass:/);
  assert.doesNotMatch(moduleVisuals, /themeId|semantic-action-accent|semantic-navigation/);
});