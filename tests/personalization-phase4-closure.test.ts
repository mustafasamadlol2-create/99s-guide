import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_PERSONALIZATION_V1,
  PERSONALIZATION_GLASS_STYLES,
  PERSONALIZATION_HERO_STYLES,
  PERSONALIZATION_MOTION_STYLES,
  PERSONALIZATION_READING_SIZES,
  PERSONALIZATION_SUBJECT_IDS,
  PERSONALIZATION_THEME_IDS,
  createDefaultPersonalization,
  type PersonalizationConfigV1,
} from "../shared/personalization.js";
import {
  applyPersonalizationDraft,
  cancelPersonalizationDraft,
  createPersonalizationState,
  personalizationConfigsEqual,
  reducePersonalizationState,
  resetPersonalizationDraft,
} from "../src/features/personalization/personalizationState.js";
import {
  isCurrentPersonalizationHydration,
  resolvePersonalizationCommit,
} from "../src/features/personalization/PersonalizationProvider.js";
import {
  getPersonalizationThemeAttribute,
  synchronizePersonalizationTheme,
} from "../src/features/personalization/personalizationTheme.js";
import {
  PERSONALIZATION_GLASS_ATTRIBUTE,
  PERSONALIZATION_HERO_ATTRIBUTE,
  PERSONALIZATION_MOTION_ATTRIBUTE,
  PERSONALIZATION_READING_ATTRIBUTE,
  synchronizePersonalizationPresentation,
} from "../src/features/personalization/personalizationPresentation.js";

const studioSource = readFileSync(
  new URL(
    "../src/features/personalization/components/My99Studio.tsx",
    import.meta.url,
  ),
  "utf8",
);
const providerSource = readFileSync(
  new URL(
    "../src/features/personalization/PersonalizationProvider.tsx",
    import.meta.url,
  ),
  "utf8",
);
const editorSource = readFileSync(
  new URL(
    "../src/features/personalization/components/HomeSubjectOrderEditor.tsx",
    import.meta.url,
  ),
  "utf8",
);
const translationsSource = readFileSync(
  new URL("../src/core/i18n/translations.ts", import.meta.url),
  "utf8",
);

function fullConfig(): PersonalizationConfigV1 {
  return {
    version: 1,
    themeId: "violet",
    heroStyle: "aurora",
    glassStyle: "frosted",
    motionStyle: "subtle",
    readingSize: "large",
    home: {
      subjectOrder: ["SSC", "ImD", "PHC", "CA", "RM", "NT", "ID"],
    },
  };
}

function makeAttributeTarget() {
  const attributes = new Map<string, string>();
  return {
    attributes,
    getAttribute: (name: string) => attributes.get(name) ?? null,
    hasAttribute: (name: string) => attributes.has(name),
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
    },
    removeAttribute: (name: string) => {
      attributes.delete(name);
    },
  } as HTMLElement & { attributes: Map<string, string> };
}

test("the final user-facing surface exposes exactly six axes", () => {
  assert.equal((studioSource.match(/role="radiogroup"/g) ?? []).length, 5);
  assert.match(studioSource, /<HomeSubjectOrderEditor/);
  assert.match(studioSource, /my99HomeSubjectOrderTitle/);
  assert.doesNotMatch(studioSource, /App Icon|Coming Soon/i);
  assert.deepEqual(
    [
      PERSONALIZATION_THEME_IDS,
      PERSONALIZATION_HERO_STYLES,
      PERSONALIZATION_GLASS_STYLES,
      PERSONALIZATION_MOTION_STYLES,
      PERSONALIZATION_READING_SIZES,
      PERSONALIZATION_SUBJECT_IDS,
    ].map((axis) => axis.length),
    [8, 4, 3, 3, 3, 7],
  );
});

test("factory defaults remain the complete safe production configuration", () => {
  assert.deepEqual(createDefaultPersonalization(), {
    version: 1,
    themeId: "classic-99",
    heroStyle: "classic",
    glassStyle: "balanced",
    motionStyle: "full",
    readingSize: "default",
    home: { subjectOrder: [...PERSONALIZATION_SUBJECT_IDS] },
  });
  assert.equal(DEFAULT_PERSONALIZATION_V1.version, 1);
  assert.deepEqual(
    DEFAULT_PERSONALIZATION_V1.home.subjectOrder,
    PERSONALIZATION_SUBJECT_IDS,
  );
});

test("factory defaults remove all five optional global presentation attributes", () => {
  const target = makeAttributeTarget();
  synchronizePersonalizationTheme(target, "classic-99");
  synchronizePersonalizationPresentation(
    target,
    "classic",
    "balanced",
    "full",
    "default",
  );

  assert.equal(getPersonalizationThemeAttribute("classic-99"), null);
  for (const attribute of [
    PERSONALIZATION_HERO_ATTRIBUTE,
    PERSONALIZATION_GLASS_ATTRIBUTE,
    PERSONALIZATION_MOTION_ATTRIBUTE,
    PERSONALIZATION_READING_ATTRIBUTE,
  ]) {
    assert.equal(target.getAttribute(attribute), null);
  }
});

test("draft changes across all six axes remain globally inert until Apply", () => {
  let state = createPersonalizationState();
  const draft = fullConfig();
  for (const [type, value] of [
    ["setThemeId", draft.themeId],
    ["setHeroStyle", draft.heroStyle],
    ["setGlassStyle", draft.glassStyle],
    ["setMotionStyle", draft.motionStyle],
    ["setReadingSize", draft.readingSize],
    ["setSubjectOrder", draft.home.subjectOrder],
  ] as const) {
    state = reducePersonalizationState(state, { type, value });
  }

  assert.equal(state.isDirty, true);
  assert.equal(state.committed.themeId, "classic-99");
  assert.equal(state.committed.heroStyle, "classic");
  assert.deepEqual(state.committed.home.subjectOrder, PERSONALIZATION_SUBJECT_IDS);
  assert.deepEqual(state.draft, draft);
  assert.match(providerSource, /committed: visibleState\.committed/);
  assert.match(providerSource, /draft: visibleState\.draft/);
});

test("six-axis Apply, failure, Cancel, and Reset preserve transactional behavior", () => {
  const initial = createPersonalizationState();
  let edited = initial;
  const draft = fullConfig();
  for (const [type, value] of [
    ["setThemeId", draft.themeId],
    ["setHeroStyle", draft.heroStyle],
    ["setGlassStyle", draft.glassStyle],
    ["setMotionStyle", draft.motionStyle],
    ["setReadingSize", draft.readingSize],
    ["setSubjectOrder", draft.home.subjectOrder],
  ] as const) {
    edited = reducePersonalizationState(edited, { type, value });
  }

  const applied = applyPersonalizationDraft(edited);
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.deepEqual(applied.config, draft);
  assert.equal(applied.state.isDirty, false);

  const failed = resolvePersonalizationCommit(applied, {
    ok: false,
    error: "storage-error",
  });
  assert.deepEqual(failed, {
    commit: false,
    error: "persistence-failed",
    reason: "storage-error",
  });

  const cancelled = cancelPersonalizationDraft(edited);
  assert.deepEqual(cancelled.draft, cancelled.committed);
  assert.equal(cancelled.isDirty, false);
  assert.deepEqual(
    resetPersonalizationDraft(edited).draft,
    createDefaultPersonalization(),
  );
  assert.equal(
    personalizationConfigsEqual(
      edited.draft,
      { ...edited.draft, home: { subjectOrder: [...edited.draft.home.subjectOrder].reverse() } },
    ),
    false,
  );
});

test("bridges stay committed-only and account hydration remains guarded", () => {
  assert.match(providerSource, /const writeResult = await writeCachedPersonalization\(/);
  assert.match(providerSource, /setState\(commit\.state\)/);
  assert.match(providerSource, /setHydration\(\{ phase: "loading", userId \}\)/);
  assert.equal(isCurrentPersonalizationHydration(1, 2, "usr_a", "usr_b"), false);
  assert.equal(isCurrentPersonalizationHydration(2, 2, "usr_a", "usr_a"), true);
  assert.doesNotMatch(editorSource, /localStorage|personalizationStorage|setAttribute|style\.setProperty|location\.reload/);
});

test("Home order remains an accessible localized list, not a seventh radiogroup", () => {
  assert.match(editorSource, /<ol/);
  assert.match(editorSource, /<li/);
  assert.match(editorSource, /my99MoveUp/);
  assert.match(editorSource, /my99MoveDown/);
  assert.match(editorSource, /disabled=\{isFirst\}/);
  assert.match(editorSource, /disabled=\{isLast\}/);
  assert.match(editorSource, /aria-hidden="true"/);
  assert.doesNotMatch(editorSource, /onDrag|draggable|role="radiogroup"/);
  assert.match(studioSource, /HOME_SUBJECT_NAME_KEYS/);
  assert.doesNotMatch(studioSource, /\{index \+ 1\}\. \{subjectId\}/);

  for (const key of [
    "my99HomeSubjectOrderTitle",
    "my99HomeSubjectOrderDescription",
    "my99HomeSubjectOrderPreviewTitle",
    "my99MoveUp",
    "my99MoveDown",
    "my99SubjectIdName",
    "my99SubjectNtName",
    "my99SubjectRmName",
    "my99SubjectCaName",
    "my99SubjectPhcName",
    "my99SubjectImdName",
    "my99SubjectSscName",
  ]) {
    assert.equal((translationsSource.match(new RegExp(`${key}:`, "g")) ?? []).length, 2);
  }
});