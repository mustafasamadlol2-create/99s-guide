import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PERSONALIZATION_HERO_STYLES,
} from "../shared/personalization.js";
import { PERSONALIZATION_HERO_CATALOG } from "../src/features/personalization/personalizationCatalog.js";
import {
  synchronizePersonalizationPresentation,
} from "../src/features/personalization/personalizationPresentation.js";
import { synchronizePersonalizationTheme } from "../src/features/personalization/personalizationTheme.js";
import {
  shouldPreservePersonalizationDuringHydration,
} from "../src/features/personalization/personalizationDocumentLifecycle.js";

function makeTarget(initial: Record<string, string> = {}) {
  const attributes = new Map(Object.entries(initial));
  const calls: string[] = [];
  const target = {
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
  };
  return {
    target: target as unknown as HTMLElement,
    calls,
    value: (name: string) => attributes.get(name) ?? null,
  };
}

const themeBridge = readFileSync(
  new URL(
    "../src/features/personalization/PersonalizationThemeBridge.tsx",
    import.meta.url,
  ),
  "utf8",
);
const presentationBridge = readFileSync(
  new URL(
    "../src/features/personalization/PersonalizationPresentationBridge.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("same-account loading preserves the last committed document owner", () => {
  assert.equal(
    shouldPreservePersonalizationDuringHydration("user-a", "user-a", "loading"),
    true,
  );
  assert.equal(
    shouldPreservePersonalizationDuringHydration(null, "user-a", "loading"),
    false,
  );
  assert.equal(
    shouldPreservePersonalizationDuringHydration("user-a", "user-b", "loading"),
    false,
  );
  assert.equal(
    shouldPreservePersonalizationDuringHydration("user-a", null, "signed-out"),
    false,
  );
});

test("Account A to Account B crosses Classic/default before B hydrates", () => {
  const theme = makeTarget();
  const presentation = makeTarget();

  synchronizePersonalizationTheme(theme.target, "rose");
  synchronizePersonalizationPresentation(
    presentation.target,
    "aurora",
    "frosted",
    "subtle",
    "large",
  );

  assert.equal(
    shouldPreservePersonalizationDuringHydration("user-a", "user-b", "loading"),
    false,
  );
  synchronizePersonalizationTheme(theme.target, "classic-99");
  synchronizePersonalizationPresentation(
    presentation.target,
    "classic",
    "balanced",
    "full",
    "default",
  );

  assert.equal(theme.value("data-app-theme"), null);
  assert.equal(presentation.value("data-app-hero-style"), null);
  assert.equal(presentation.value("data-app-glass-style"), null);
  assert.equal(presentation.value("data-app-motion-style"), null);
  assert.equal(presentation.value("data-app-reading-size"), null);

  synchronizePersonalizationTheme(theme.target, "ocean");
  synchronizePersonalizationPresentation(
    presentation.target,
    "night",
    "balanced",
    "full",
    "default",
  );
  assert.equal(theme.value("data-app-theme"), "ocean");
  assert.equal(presentation.value("data-app-hero-style"), "night");
});

test("logout removes every account-scoped document attribute", () => {
  const theme = makeTarget({ "data-app-theme": "rose" });
  const presentation = makeTarget({
    "data-app-hero-style": "aurora",
    "data-app-glass-style": "frosted",
    "data-app-motion-style": "subtle",
    "data-app-reading-size": "large",
  });

  synchronizePersonalizationTheme(theme.target, "classic-99");
  synchronizePersonalizationPresentation(
    presentation.target,
    "classic",
    "balanced",
    "full",
    "default",
  );

  assert.equal(theme.value("data-app-theme"), null);
  for (const attribute of [
    "data-app-hero-style",
    "data-app-glass-style",
    "data-app-motion-style",
    "data-app-reading-size",
  ]) {
    assert.equal(presentation.value(attribute), null);
  }
});

test("stale A hydration cannot claim B ownership and StrictMode sync is idempotent", () => {
  assert.equal(
    shouldPreservePersonalizationDuringHydration("user-a", "user-b", "loading"),
    false,
  );

  const theme = makeTarget();
  synchronizePersonalizationTheme(theme.target, "ocean");
  const firstCallCount = theme.calls.length;
  synchronizePersonalizationTheme(theme.target, "ocean");
  assert.equal(theme.calls.length, firstCallCount);

  const presentation = makeTarget();
  synchronizePersonalizationPresentation(
    presentation.target,
    "night",
    "balanced",
    "full",
    "default",
  );
  const firstPresentationCallCount = presentation.calls.length;
  synchronizePersonalizationPresentation(
    presentation.target,
    "night",
    "balanced",
    "full",
    "default",
  );
  assert.equal(presentation.calls.length, firstPresentationCallCount);
});

test("HeroStyle runtime contract contains only canonical IDs", () => {
  assert.deepEqual([...PERSONALIZATION_HERO_STYLES], [
    "classic",
    "minimal",
    "night",
    "aurora",
  ]);
  assert.deepEqual(
    PERSONALIZATION_HERO_CATALOG.map(({ id }) => id),
    ["classic", "minimal", "night", "aurora"],
  );
  assert.match(themeBridge, /shouldPreservePersonalizationDuringHydration/);
  assert.match(presentationBridge, /shouldPreservePersonalizationDuringHydration/);
});

test("canonical Theme × Hero combinations keep color and presentation ownership separate", () => {
  const combinations: Array<[string, string]> = [
    ["rose", "classic"],
    ["rose", "minimal"],
    ["rose", "night"],
    ["rose", "aurora"],
    ["ocean", "night"],
    ["monochrome", "aurora"],
  ];

  for (const [themeId, heroStyle] of combinations) {
    const theme = makeTarget();
    const presentation = makeTarget();

    synchronizePersonalizationTheme(theme.target, themeId);
    synchronizePersonalizationPresentation(
      presentation.target,
      heroStyle,
      "balanced",
      "full",
      "default",
    );

    assert.equal(theme.value("data-app-theme"), themeId);
    assert.equal(
      presentation.value("data-app-hero-style"),
      heroStyle === "classic" ? null : heroStyle,
    );
  }
});