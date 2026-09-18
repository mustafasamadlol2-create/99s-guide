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
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(
  new URL("../src/core/layout/SidebarNavItem.tsx", import.meta.url),
  "utf8",
);
const tabBar = readFileSync(
  new URL("../src/core/layout/TabBarItem.tsx", import.meta.url),
  "utf8",
);
const iosAlert = readFileSync(
  new URL("../src/core/layout/iOSAlert.tsx", import.meta.url),
  "utf8",
);
const settings = readFileSync(
  new URL("../src/features/settings/components/SettingsView.tsx", import.meta.url),
  "utf8",
);
const profile = readFileSync(
  new URL("../src/features/profile/components/ProfileView.tsx", import.meta.url),
  "utf8",
);
const bulletin = readFileSync(
  new URL("../src/features/bulletin/components/BulletinCenter.tsx", import.meta.url),
  "utf8",
);
const moduleDetail = readFileSync(
  new URL("../src/features/modules/components/ModulePlaceholderView.tsx", import.meta.url),
  "utf8",
);

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

test("core chrome consumes semantic presentation tokens", () => {
  assert.match(app, /bg-semantic-background-page/);
  assert.match(app, /text-semantic-content-primary/);
  assert.match(app, /text-semantic-chrome-content-primary/);
  assert.match(app, /text-semantic-chrome-content-muted/);
  assert.match(app, /text-semantic-navigation-tab-active/);
  assert.match(app, /text-semantic-navigation-tab-inactive/);
  assert.match(sidebar, /bg-semantic-chrome-surface-active/);
  assert.match(sidebar, /bg-semantic-chrome-surface-hover/);
  assert.match(sidebar, /text-semantic-chrome-content-secondary/);
  assert.match(sidebar, /ring-semantic-focus-ring/);
  assert.match(tabBar, /colorClass = "text-semantic-navigation-tab-inactive"/);
  assert.match(tabBar, /activeColorClass = "text-semantic-navigation-tab-active"/);
});

test("iOS alert generic and destructive actions stay semantically isolated", () => {
  assert.match(iosAlert, /text-semantic-navigation-tab-active/);
  const destructiveBranch =
    iosAlert.split("} else if (isDestructive) {")[1]?.split("}")[0] ?? "";
  assert.equal(destructiveBranch.includes("text-med-error dark:text-red-400"), true);
  assert.equal(destructiveBranch.includes("semantic-navigation-tab-active"), false);
});

test("Prompt 7 low-risk feature shells consume exact generic tokens", () => {
  assert.match(settings, /text-semantic-chrome-content-primary/);
  assert.match(settings, /text-semantic-chrome-content-secondary/);
  assert.match(settings, /bg-semantic-surface-elevated/);

  assert.match(profile, /bg-semantic-background-page/);
  assert.match(profile, /text-semantic-chrome-content-primary/);
  assert.match(profile, /text-semantic-chrome-content-secondary/);

  assert.match(bulletin, /bg-semantic-background-page/);
  assert.match(bulletin, /bg-semantic-surface-elevated/);
  assert.match(bulletin, /text-semantic-chrome-content-primary/);
  assert.match(bulletin, /text-semantic-chrome-content-secondary/);

  assert.match(moduleDetail, /text-semantic-chrome-content-primary/);
  assert.doesNotMatch(moduleDetail, /semantic-action-accent|semantic-navigation-tab-active/);
});

test("Prompt 7 preserves feature-specific status and destructive colors", () => {
  assert.match(settings, /text-med-error dark:text-red-400/);
  assert.match(settings, /bg-red-50 dark:bg-med-error\/10/);

  assert.match(profile, /text-amber-500/);
  assert.match(profile, /text-blue-500/);

  assert.match(bulletin, /bg-blue-500 dark:bg-blue-400/);
  assert.match(bulletin, /bg-red-500 dark:bg-red-600/);
  assert.match(bulletin, /isDestructive: true/);
  assert.match(bulletin, /hover:text-red-600 dark:hover:text-red-400/);
});
