import test from "node:test";
import assert from "node:assert/strict";
import {
  PERSONALIZATION_SUBJECT_IDS,
  type PersonalizationConfigV1,
  createDefaultPersonalization,
} from "../shared/personalization.js";
import {
  applyPersonalizationDraft,
  cancelPersonalizationDraft,
  createPersonalizationState,
  personalizationConfigsEqual,
  reducePersonalizationState,
  resetPersonalizationDraft,
} from "../src/features/personalization/personalizationState.js";

function validConfig(): PersonalizationConfigV1 {
  return {
    version: 1,
    themeId: "classic-99",
    heroStyle: "classic",
    glassStyle: "balanced",
    motionStyle: "full",
    readingSize: "default",
    home: { subjectOrder: [...PERSONALIZATION_SUBJECT_IDS] },
  };
}

test("default state has independent Classic 99 committed and draft configs", () => {
  const state = createPersonalizationState();

  assert.deepEqual(state.committed, createDefaultPersonalization());
  assert.deepEqual(state.draft, createDefaultPersonalization());
  assert.equal(state.isDirty, false);
  assert.notEqual(state.committed, state.draft);
  assert.notEqual(state.committed.home.subjectOrder, state.draft.home.subjectOrder);
});

test("valid initial config is normalized into independent clean state", () => {
  const config = validConfig();
  config.themeId = "emerald";
  config.heroStyle = "minimal";
  config.glassStyle = "frosted";
  config.motionStyle = "subtle";
  config.readingSize = "large";

  const state = createPersonalizationState(config);

  assert.deepEqual(state.committed, config);
  assert.deepEqual(state.draft, config);
  assert.equal(state.isDirty, false);
  assert.notEqual(state.committed.home.subjectOrder, config.home.subjectOrder);
  assert.notEqual(state.draft.home.subjectOrder, config.home.subjectOrder);
});

test("invalid initial config safely becomes Classic 99", () => {
  const state = createPersonalizationState({
    version: 1,
    themeId: "rainbow",
    home: { subjectOrder: ["ID", "NT"] },
  });

  assert.deepEqual(state.committed, createDefaultPersonalization());
  assert.deepEqual(state.draft, createDefaultPersonalization());
  assert.equal(state.isDirty, false);
});

test("draft edits keep committed unchanged and update dirty state semantically", () => {
  const initial = createPersonalizationState();
  const edited = reducePersonalizationState(initial, {
    type: "setThemeId",
    value: "emerald",
  });

  assert.equal(initial.committed.themeId, "classic-99");
  assert.equal(edited.committed.themeId, "classic-99");
  assert.equal(edited.draft.themeId, "emerald");
  assert.equal(edited.isDirty, true);

  const reverted = reducePersonalizationState(edited, {
    type: "setThemeId",
    value: "classic-99",
  });
  assert.equal(reverted.isDirty, false);
  assert.deepEqual(reverted.draft, reverted.committed);
});

test("all draft fields accept only canonical values", () => {
  let state = createPersonalizationState();
  state = reducePersonalizationState(state, { type: "setHeroStyle", value: "night" });
  state = reducePersonalizationState(state, { type: "setGlassStyle", value: "clear" });
  state = reducePersonalizationState(state, { type: "setMotionStyle", value: "reduced" });
  state = reducePersonalizationState(state, { type: "setReadingSize", value: "small" });
  state = reducePersonalizationState(state, {
    type: "setSubjectOrder",
    value: [...PERSONALIZATION_SUBJECT_IDS].reverse(),
  });

  assert.equal(state.draft.heroStyle, "night");
  assert.equal(state.draft.glassStyle, "clear");
  assert.equal(state.draft.motionStyle, "reduced");
  assert.equal(state.draft.readingSize, "small");
  assert.deepEqual(
    state.draft.home.subjectOrder,
    [...PERSONALIZATION_SUBJECT_IDS].reverse(),
  );
  assert.equal(state.isDirty, true);
});

test("invalid draft actions are ignored without changing state", () => {
  const state = createPersonalizationState();
  const invalidActions = [
    { type: "setThemeId", value: "rainbow" },
    { type: "setHeroStyle", value: "ambient" },
    { type: "setGlassStyle", value: "opaque" },
    { type: "setMotionStyle", value: "instant" },
    { type: "setReadingSize", value: "huge" },
    { type: "setSubjectOrder", value: ["ID", "NT"] },
  ] as const;

  for (const action of invalidActions) {
    const next = reducePersonalizationState(state, action);
    assert.deepEqual(next, state);
  }
});

test("cancel restores a fresh draft copy of committed state", () => {
  let state = createPersonalizationState();
  state = reducePersonalizationState(state, { type: "setThemeId", value: "midnight" });
  state = reducePersonalizationState(state, { type: "setHeroStyle", value: "night" });

  const cancelled = cancelPersonalizationDraft(state);

  assert.equal(cancelled.committed.themeId, "classic-99");
  assert.equal(cancelled.draft.themeId, "classic-99");
  assert.equal(cancelled.isDirty, false);
  assert.notEqual(cancelled.committed, cancelled.draft);
  assert.notEqual(cancelled.committed.home.subjectOrder, cancelled.draft.home.subjectOrder);
});

test("reset changes only draft until Apply and detects Classic 99 difference", () => {
  let state = createPersonalizationState();
  state = reducePersonalizationState(state, { type: "setThemeId", value: "emerald" });

  const reset = resetPersonalizationDraft(state);

  assert.equal(reset.committed.themeId, "classic-99");
  assert.equal(reset.draft.themeId, "classic-99");
  assert.equal(reset.isDirty, false);

  const customState = createPersonalizationState({
    ...validConfig(),
    themeId: "emerald",
  });
  const resetCustom = resetPersonalizationDraft(customState);
  assert.equal(resetCustom.committed.themeId, "emerald");
  assert.equal(resetCustom.draft.themeId, "classic-99");
  assert.equal(resetCustom.isDirty, true);
});

test("cancel after reset returns the committed custom config", () => {
  const customState = createPersonalizationState({
    ...validConfig(),
    themeId: "emerald",
  });
  const cancelled = cancelPersonalizationDraft(resetPersonalizationDraft(customState));

  assert.equal(cancelled.committed.themeId, "emerald");
  assert.equal(cancelled.draft.themeId, "emerald");
  assert.equal(cancelled.isDirty, false);
});

test("apply commits a clean snapshot and returns it without persistence", () => {
  let state = createPersonalizationState();
  state = reducePersonalizationState(state, { type: "setThemeId", value: "ocean" });

  const result = applyPersonalizationDraft(state);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.config.themeId, "ocean");
  assert.equal(result.state.committed.themeId, "ocean");
  assert.equal(result.state.draft.themeId, "ocean");
  assert.equal(result.state.isDirty, false);
  assert.notEqual(result.config, result.state.committed);
  assert.notEqual(result.state.committed, result.state.draft);
});

test("equality is canonical and subject-order sensitive", () => {
  const left = validConfig();
  const right = validConfig();
  assert.equal(personalizationConfigsEqual(left, right), true);

  const reordered = {
    ...right,
    home: {
      subjectOrder: [...PERSONALIZATION_SUBJECT_IDS].reverse(),
    },
  };
  assert.equal(personalizationConfigsEqual(left, reordered), false);
});