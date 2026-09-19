import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PERSONALIZATION_SUBJECT_IDS, type PersonalizationConfigV2 } from "../shared/personalization.js";
import {
  PersonalizationProvider,
  isCurrentPersonalizationHydration,
  resolvePersonalizationHydration,
  resolvePersonalizationCommit,
} from "../src/features/personalization/PersonalizationProvider.js";
import {
  createPersonalizationState,
  reducePersonalizationState,
} from "../src/features/personalization/personalizationState.js";

function config(): PersonalizationConfigV2 {
  return {
    version: 2,
    themeId: "classic-99",
    heroStyle: "classic",
    glassStyle: "balanced",
    motionStyle: "full",
    readingSize: "default",
    home: {
      subjectOrder: [...PERSONALIZATION_SUBJECT_IDS],
      hiddenSubjectIds: [],
      semesterVisibility: { semester1: true, semester2: true },
    },
  };
}

test("provider renders children without a visual wrapper", () => {
  const markup = renderToStaticMarkup(
    <PersonalizationProvider userId={null}>
      <span data-testid="unchanged">content</span>
    </PersonalizationProvider>,
  );

  assert.equal(markup, '<span data-testid="unchanged">content</span>');
});

test("hydration maps found cache to ready cache status", () => {
  const result = resolvePersonalizationHydration("usr_test", {
    status: "found",
    config: config(),
    savedAt: "2026-09-18T12:00:00Z",
  });

  assert.deepEqual(result, {
    config: config(),
    status: {
      phase: "ready",
      userId: "usr_test",
      source: "cache",
      savedAt: "2026-09-18T12:00:00Z",
    },
  });
});

test("missing cache maps to ready Classic 99 default status", () => {
  const result = resolvePersonalizationHydration("usr_test", {
    status: "missing",
    config: config(),
  });

  assert.equal(result.status.phase, "ready");
  if (result.status.phase === "ready") {
    assert.equal(result.status.source, "default");
    assert.equal(result.status.userId, "usr_test");
  }
});

test("invalid cache maps to safe fallback status", () => {
  const result = resolvePersonalizationHydration("usr_test", {
    status: "invalid",
    config: config(),
    reason: "storage-error",
  });

  assert.deepEqual(result.status, {
    phase: "fallback",
    userId: "usr_test",
    reason: "storage-error",
  });
});

test("late hydration from an older request cannot update a newer account", () => {
  assert.equal(
    isCurrentPersonalizationHydration(1, 2, "usr_a", "usr_b"),
    false,
  );
  assert.equal(
    isCurrentPersonalizationHydration(2, 2, "usr_a", "usr_a"),
    true,
  );
  assert.equal(
    isCurrentPersonalizationHydration(2, 2, "usr_a", null),
    false,
  );
});

test("persistence failure does not authorize an in-memory Apply commit", () => {
  let state = createPersonalizationState();
  state = reducePersonalizationState(state, {
    type: "setThemeId",
    value: "ocean",
  });
  const applied = {
    ok: true as const,
    state: {
      ...state,
      committed: { ...state.draft },
      draft: { ...state.draft },
      isDirty: false,
    },
    config: { ...state.draft },
  };

  const decision = resolvePersonalizationCommit(applied, {
    ok: false,
    error: "storage-error",
  });

  assert.deepEqual(decision, {
    commit: false,
    error: "persistence-failed",
    reason: "storage-error",
  });
  assert.equal(state.committed.themeId, "classic-99");
  assert.equal(state.draft.themeId, "ocean");
  assert.equal(state.isDirty, true);
});