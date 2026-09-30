import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_STUDY_FEATURE_FLAGS,
  getStudyFeatureFlags,
  isStudyFeatureEnabled,
} from "../server/features/study-core/featureFlags.js";

test("core completed Study Engine features are enabled by default", () => {
  const flags = getStudyFeatureFlags({});

  assert.equal(flags.STUDY_EVENTS_ENABLED, true);
  assert.equal(flags.FOCUS_HUB_ENABLED, true);
  assert.equal(flags.FOCUS_RESOURCE_HANDOFF_ENABLED, true);
  assert.equal(flags.STUDY_POINTS_ENABLED, true);
  assert.equal(flags.STUDY_INTEGRITY_ENABLED, true);
  assert.equal(flags.GAMIFICATION_ENABLED, true);
  assert.equal(flags.SPACED_RECALL_ENABLED, true);
  assert.equal(flags.RECALL_POINTS_ENABLED, true);
  assert.equal(flags.MASTERY_ENABLED, true);
  assert.equal(flags.STUDY_ANALYZER_ENABLED, true);
  assert.equal(flags.ASK_MY_STUDY_DATA_ENABLED, true);
  assert.equal(flags.OWNER_STUDY_ANALYTICS_ENABLED, true);
});

test("optional external-infrastructure features remain opt-in", () => {
  const flags = getStudyFeatureFlags({});

  assert.equal(flags.GROUP_FOCUS_ENABLED, false);
  assert.equal(flags.AI_STUDY_INSIGHTS_ENABLED, false);
  assert.equal(flags.AI_STUDY_INSIGHTS_CACHE_ENABLED, false);
  assert.equal(flags.ASK_MY_STUDY_DATA_AI_ENABLED, false);
  assert.equal(flags.LEADERBOARD_D1_PROJECTION_ENABLED, false);
  assert.equal(flags.LEADERBOARD_D1_READ_ENABLED, false);
});

test("explicit environment kill switches override release defaults", () => {
  const flags = getStudyFeatureFlags({
    FOCUS_HUB_ENABLED: "false",
    STUDY_ANALYZER_ENABLED: "0",
    MASTERY_ENABLED: "off",
    SPACED_RECALL_ENABLED: "no",
  });

  assert.equal(flags.FOCUS_HUB_ENABLED, false);
  assert.equal(flags.STUDY_ANALYZER_ENABLED, false);
  assert.equal(flags.MASTERY_ENABLED, false);
  assert.equal(flags.SPACED_RECALL_ENABLED, false);
});

test("optional features can still be explicitly enabled", () => {
  assert.equal(
    isStudyFeatureEnabled("GROUP_FOCUS_ENABLED", {
      GROUP_FOCUS_ENABLED: "true",
    }),
    true,
  );
  assert.equal(
    isStudyFeatureEnabled("AI_STUDY_INSIGHTS_ENABLED", {
      AI_STUDY_INSIGHTS_ENABLED: "1",
    }),
    true,
  );
});

test("default object matches runtime fallback for every flag", () => {
  assert.deepEqual(getStudyFeatureFlags({}), DEFAULT_STUDY_FEATURE_FLAGS);
});
