import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PERSONALIZATION_V2,
  PERSONALIZATION_SUBJECT_IDS,
  createDefaultPersonalization,
  type PersonalizationConfigV2,
} from "../shared/personalization.js";
import {
  isCurrentPersonalizationHydration,
  resolvePersonalizationCommit,
  resolvePersonalizationHydration,
} from "../src/features/personalization/PersonalizationProvider.js";
import {
  applyPersonalizationDraft,
  cancelPersonalizationDraft,
  createPersonalizationState,
  reducePersonalizationState,
  resetPersonalizationDraft,
} from "../src/features/personalization/personalizationState.js";
import {
  getLegacyPersonalizationCacheKey,
  getPersonalizationCacheKey,
  readCachedPersonalization,
  type PersonalizationKeyValueStorage,
} from "../src/features/personalization/personalizationStorage.js";

const userId = "usr_r4-integration";

class MemoryStorage implements PersonalizationKeyValueStorage {
  readonly values = new Map<string, string>();
  failSet = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error("set failed");
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function richConfig(): PersonalizationConfigV2 {
  return {
    version: 2,
    themeId: "rose",
    heroStyle: "aurora",
    glassStyle: "frosted",
    motionStyle: "subtle",
    readingSize: "large",
    home: {
      subjectOrder: ["SSC", "ImD", "PHC", "CA", "RM", "NT", "ID"],
      hiddenSubjectIds: ["NT"],
      semesterVisibility: { semester1: true, semester2: false },
    },
  };
}

function setAllAxes(
  state: ReturnType<typeof createPersonalizationState>,
  config: PersonalizationConfigV2,
) {
  for (const [type, value] of [
    ["setThemeId", config.themeId],
    ["setHeroStyle", config.heroStyle],
    ["setGlassStyle", config.glassStyle],
    ["setMotionStyle", config.motionStyle],
    ["setReadingSize", config.readingSize],
    ["setSubjectOrder", config.home.subjectOrder],
    ["setHiddenSubjectIds", config.home.hiddenSubjectIds],
    ["setSemesterVisibility", config.home.semesterVisibility],
  ] as const) {
    state = reducePersonalizationState(state, { type, value });
  }
  return state;
}

test("multi-axis Draft stays inert, then Apply commits one coherent ConfigV2", () => {
  const draftState = setAllAxes(createPersonalizationState(), richConfig());

  assert.equal(draftState.isDirty, true);
  assert.deepEqual(draftState.committed, createDefaultPersonalization());
  assert.deepEqual(draftState.draft, richConfig());

  const applied = applyPersonalizationDraft(draftState);
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.deepEqual(applied.config, richConfig());
  assert.equal(applied.state.isDirty, false);
  assert.deepEqual(applied.state.committed, richConfig());
});

test("multi-axis Cancel and Reset never mutate committed state", () => {
  const edited = setAllAxes(createPersonalizationState(), richConfig());
  const cancelled = cancelPersonalizationDraft(edited);
  assert.deepEqual(cancelled.committed, DEFAULT_PERSONALIZATION_V2);
  assert.deepEqual(cancelled.draft, DEFAULT_PERSONALIZATION_V2);
  assert.equal(cancelled.isDirty, false);

  const reset = resetPersonalizationDraft(edited);
  assert.deepEqual(reset.committed, DEFAULT_PERSONALIZATION_V2);
  assert.deepEqual(reset.draft, DEFAULT_PERSONALIZATION_V2);
  assert.equal(reset.isDirty, false);
});

test("V1 migration write failure preserves durable ownership and Provider fallback", async () => {
  const storage = new MemoryStorage();
  const legacyKey = getLegacyPersonalizationCacheKey(userId)!;
  const currentKey = getPersonalizationCacheKey(userId)!;
  storage.values.set(
    legacyKey,
    JSON.stringify({
      cacheVersion: 1,
      savedAt: "2026-09-18T12:00:00Z",
      config: {
        version: 1,
        themeId: "rose",
        heroStyle: "aurora",
        glassStyle: "frosted",
        motionStyle: "subtle",
        readingSize: "large",
        home: { subjectOrder: [...PERSONALIZATION_SUBJECT_IDS].reverse() },
      },
    }),
  );
  storage.failSet = true;

  const read = await readCachedPersonalization(userId, storage);
  assert.equal(read.status, "invalid");
  if (read.status !== "invalid") return;

  const hydration = resolvePersonalizationHydration(userId, read);
  assert.deepEqual(hydration.config, createDefaultPersonalization());
  assert.deepEqual(hydration.status, {
    phase: "fallback",
    userId,
    reason: "storage-error",
  });
  assert.equal(storage.values.has(legacyKey), true);
  assert.equal(storage.values.has(currentKey), false);
});

test("account boundaries reject stale presentation and Home hydration together", () => {
  assert.equal(isCurrentPersonalizationHydration(4, 5, userId, userId), false);
  assert.equal(isCurrentPersonalizationHydration(5, 5, userId, "usr_other"), false);
  assert.equal(isCurrentPersonalizationHydration(5, 5, userId, userId), true);

  const failedCommit = resolvePersonalizationCommit(
    {
      ok: true,
      state: setAllAxes(createPersonalizationState(), richConfig()),
      config: richConfig(),
    },
    { ok: false, error: "storage-error" },
  );
  assert.deepEqual(failedCommit, {
    commit: false,
    error: "persistence-failed",
    reason: "storage-error",
  });
});