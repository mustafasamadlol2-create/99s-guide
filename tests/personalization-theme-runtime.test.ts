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
  type PersonalizationConfigV1,
} from "../shared/personalization.js";
import {
  getPersonalizationThemeAttribute,
  resolveVisualThemeId,
  synchronizePersonalizationTheme,
} from "../src/features/personalization/personalizationTheme.js";
import { applyPersonalizationDraft, createPersonalizationState, reducePersonalizationState } from "../src/features/personalization/personalizationState.js";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const bridge = readFileSync(
  new URL("../src/features/personalization/PersonalizationThemeBridge.tsx", import.meta.url),
  "utf8",
);

const OCEAN_LIGHT = {
  "semantic-background-page": "#f3f8fc",
  "semantic-background-grouped": "#eaf3f8",
  "semantic-surface-primary": "#f8fcfe",
  "semantic-surface-elevated": "#ffffff",
  "semantic-surface-muted": "#ddecf4",
  "semantic-content-primary": "#102b38",
  "semantic-content-secondary": "#587482",
  "semantic-content-subtle": "rgba(34, 72, 91, 0.62)",
  "semantic-border-default": "rgba(13, 104, 135, 0.08)",
  "semantic-border-strong": "rgba(13, 104, 135, 0.15)",
  "semantic-action-accent": "#007c91",
  "semantic-action-accent-soft": "rgba(0, 124, 145, 0.11)",
  "semantic-focus-ring": "#007c91",
  "semantic-navigation-active-background": "rgba(0, 124, 145, 0.12)",
  "semantic-navigation-active-foreground": "#07586a",
  "semantic-glass-surface": "rgba(248, 253, 255, 0.68)",
  "semantic-glass-border": "rgba(16, 105, 135, 0.10)",
  "semantic-shadow-generic": "var(--shadow-elevation-1)",
  "semantic-hero-background": "#031a24",
  "semantic-hero-glow-primary": "rgba(0, 150, 190, 0.42)",
  "semantic-hero-glow-secondary": "rgba(45, 190, 170, 0.20)",
  "semantic-chrome-content-primary": "#0f2833",
  "semantic-chrome-content-secondary": "#5e7985",
  "semantic-chrome-content-subtle": "#829aa4",
  "semantic-chrome-content-muted": "#456572",
  "semantic-chrome-surface-active": "rgba(0, 124, 145, 0.12)",
  "semantic-chrome-surface-hover": "rgba(0, 124, 145, 0.07)",
  "semantic-navigation-tab-active": "#007c91",
  "semantic-navigation-tab-inactive": "#5e7985",
} as const;

const OCEAN_DARK = {
  "semantic-background-page": "#061116",
  "semantic-background-grouped": "#08191f",
  "semantic-surface-primary": "#08191f",
  "semantic-surface-elevated": "#0d252e",
  "semantic-surface-muted": "#153640",
  "semantic-content-primary": "#f2fbfd",
  "semantic-content-secondary": "rgba(225, 245, 249, 0.72)",
  "semantic-content-subtle": "rgba(225, 245, 249, 0.48)",
  "semantic-border-default": "rgba(139, 224, 238, 0.08)",
  "semantic-border-strong": "rgba(139, 224, 238, 0.15)",
  "semantic-action-accent": "#4cc9e7",
  "semantic-action-accent-soft": "rgba(76, 201, 231, 0.13)",
  "semantic-focus-ring": "#4cc9e7",
  "semantic-navigation-active-background": "rgba(76, 201, 231, 0.15)",
  "semantic-navigation-active-foreground": "#ddf8ff",
  "semantic-glass-surface": "rgba(13, 37, 46, 0.72)",
  "semantic-glass-border": "rgba(122, 213, 232, 0.12)",
  "semantic-shadow-generic": "var(--shadow-elevation-1)",
  "semantic-hero-background": "#020b10",
  "semantic-hero-glow-primary": "rgba(0, 145, 190, 0.42)",
  "semantic-hero-glow-secondary": "rgba(28, 175, 165, 0.22)",
  "semantic-chrome-content-primary": "#f2fbfd",
  "semantic-chrome-content-secondary": "rgba(225, 245, 249, 0.70)",
  "semantic-chrome-content-subtle": "rgba(225, 245, 249, 0.48)",
  "semantic-chrome-content-muted": "#a8c8d0",
  "semantic-chrome-surface-active": "rgba(76, 201, 231, 0.15)",
  "semantic-chrome-surface-hover": "rgba(76, 201, 231, 0.08)",
  "semantic-navigation-tab-active": "#4cc9e7",
  "semantic-navigation-tab-inactive": "rgba(225, 245, 249, 0.68)",
} as const;

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

function makeTarget(initial: string | null = null) {
  let value = initial;
  const calls: string[] = [];
  return {
    calls,
    target: {
      getAttribute: () => value,
      setAttribute: (_name: string, next: string) => {
        value = next;
        calls.push(`set:${next}`);
      },
      removeAttribute: () => {
        value = null;
        calls.push("remove");
      },
    },
    value: () => value,
  };
}

test("resolver implements only Classic 99 and Ocean", () => {
  assert.deepEqual(IMPLEMENTED_THEME_IDS, ["classic-99", "ocean"]);
  assert.equal(resolveVisualThemeId("classic-99"), "classic-99");
  assert.equal(resolveVisualThemeId("ocean"), "ocean");
  for (const themeId of PERSONALIZATION_THEME_IDS.filter((id) => !IMPLEMENTED_THEME_IDS.includes(id as never))) {
    assert.equal(resolveVisualThemeId(themeId), "classic-99");
  }
});

test("attribute mapping removes Classic/fallback and selects Ocean", () => {
  assert.equal(getPersonalizationThemeAttribute("classic-99"), null);
  assert.equal(getPersonalizationThemeAttribute("ocean"), "ocean");
  assert.equal(getPersonalizationThemeAttribute("emerald"), null);
});

test("attribute synchronization is scoped, idempotent, and StrictMode-safe", () => {
  const target = makeTarget("ocean");
  synchronizePersonalizationTheme(target.target, "ocean");
  synchronizePersonalizationTheme(target.target, "emerald");
  synchronizePersonalizationTheme(target.target, "classic-99");
  synchronizePersonalizationTheme(target.target, "classic-99");
  assert.deepEqual(target.calls, ["remove"]);
  assert.equal(target.value(), null);

  const ocean = makeTarget(null);
  synchronizePersonalizationTheme(ocean.target, "ocean");
  synchronizePersonalizationTheme(ocean.target, "ocean");
  assert.deepEqual(ocean.calls, ["set:ocean"]);
});

test("Ocean defines exactly all 29 themeable tokens in Light and Dark", () => {
  assert.deepEqual(declarations(block(':root[data-app-theme="ocean"]')), OCEAN_LIGHT);
  assert.deepEqual(declarations(block('.dark[data-app-theme="ocean"]')), OCEAN_DARK);
  assert.equal(THEMEABLE_TOKEN_NAMES.length, 29);
  assert.deepEqual(Object.keys(OCEAN_LIGHT).sort(), [...THEMEABLE_TOKEN_NAMES].sort());
  assert.deepEqual(Object.keys(OCEAN_DARK).sort(), [...THEMEABLE_TOKEN_NAMES].sort());
});

test("Ocean uses only the two intended selectors and never overrides fixed semantics", () => {
  assert.equal((css.match(/(?:^|\n)(?:\.dark)?\[?data-app-theme="ocean"/g) ?? []).length, 0);
  assert.equal((css.match(/:root\[data-app-theme="ocean"\]\s*\{/g) ?? []).length, 1);
  assert.equal((css.match(/\.dark\[data-app-theme="ocean"\]\s*\{/g) ?? []).length, 1);
  const oceanCss = `${block(':root[data-app-theme="ocean"]')}\n${block('.dark[data-app-theme="ocean"]')}`;
  for (const tokenName of FIXED_SEMANTIC_TOKEN_NAMES) {
    assert.doesNotMatch(oceanCss, new RegExp(`--${tokenName}\\s*:`));
  }
  assert.doesNotMatch(css, /\[data-app-theme="ocean"\][^{]*\.(?:sidebar|calendar|mcq|flashcard|lecture)/i);
});

test("bridge reads committed only and mutates only data-app-theme", () => {
  assert.match(bridge, /const \{ committed \} = usePersonalization\(\)/);
  assert.doesNotMatch(bridge, /\bdraft\b/);
  assert.match(bridge, /data-app-theme/);
  assert.doesNotMatch(bridge, /style\.setProperty|location\.reload|key\s*=/);
  assert.doesNotMatch(bridge, /classList|html\.dark|theme-color/);
});

function oceanDraftConfig(): PersonalizationConfigV1 {
  let state = createPersonalizationState();
  state = reducePersonalizationState(state, { type: "setThemeId", value: "ocean" });
  return applyPersonalizationDraft(state).config;
}

test("draft and transactional Apply semantics control when Ocean can appear", () => {
  const target = makeTarget();
  let state = createPersonalizationState();
  state = reducePersonalizationState(state, { type: "setThemeId", value: "ocean" });
  synchronizePersonalizationTheme(target.target, state.committed.themeId);
  assert.equal(target.value(), null);
  assert.equal(state.draft.themeId, "ocean");
  assert.equal(state.committed.themeId, "classic-99");

  const applied = applyPersonalizationDraft(state);
  assert.equal(applied.ok, true);
  if (applied.ok) {
    synchronizePersonalizationTheme(target.target, applied.state.committed.themeId);
  }
  assert.equal(target.value(), "ocean");
  assert.equal(oceanDraftConfig().themeId, "ocean");
});

test("Classic fallback clears Ocean across account boundaries and logout", () => {
  const target = makeTarget("ocean");
  synchronizePersonalizationTheme(target.target, "emerald");
  assert.equal(target.value(), null);
  synchronizePersonalizationTheme(target.target, "classic-99");
  assert.equal(target.value(), null);
  assert.deepEqual(target.calls, ["remove"]);
});