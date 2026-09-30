import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_LEADERBOARD_PERIOD,
  DEFAULT_STUDY_FEATURE_FLAGS,
  EVIDENCE_CLASS_RANK,
  EVIDENCE_CLASSES,
  FOCUS_ALLOWED_TRANSITIONS,
  FOCUS_SESSION_STATES,
  FOCUS_TERMINAL_STATES,
  GROUP_FOCUS_CONFIG_DEFAULTS,
  IDEMPOTENCY_RESULTS,
  IDEMPOTENCY_SCOPES,
  LEADERBOARD_PERIODS,
  MASTERY_STATES,
  POINT_CATEGORIES,
  PRIVACY_CLASSES,
  RECALL_RESPONSE_STATUSES,
  STUDY_EVENT_SOURCES,
  STUDY_EVENT_TYPES,
  STUDY_FEATURE_FLAGS,
  canTransitionFocusSession,
  getStudyFeatureFlags,
  parseStudyFeatureFlag,
} from "../server/features/study-core/index.ts";

test("freezes every Study Event name without duplicate values", () => {
  assert.equal(STUDY_EVENT_TYPES.length, 25);
  assert.equal(new Set(STUDY_EVENT_TYPES).size, STUDY_EVENT_TYPES.length);
  assert.deepEqual(STUDY_EVENT_SOURCES, [
    "web",
    "pwa",
    "ios",
    "android",
    "backend",
    "durable_object",
    "offline_replay",
  ]);
});

test("Focus state transitions accept only the frozen map", () => {
  for (const [from, targets] of Object.entries(FOCUS_ALLOWED_TRANSITIONS)) {
    for (const to of targets) {
      assert.equal(
        canTransitionFocusSession(
          from as (typeof FOCUS_SESSION_STATES)[number],
          to,
        ),
        true,
      );
    }
  }

  assert.equal(canTransitionFocusSession("CREATED", "PAUSED"), false);
  assert.equal(canTransitionFocusSession("ACTIVE", "CREATED"), false);
  assert.equal(canTransitionFocusSession("PAUSED", "COMPLETED"), false);
  assert.equal(canTransitionFocusSession("COMPLETED", "ACTIVE"), false);
  assert.equal(canTransitionFocusSession("ABANDONED", "ACTIVE"), false);
  assert.equal(canTransitionFocusSession("EXPIRED", "ACTIVE"), false);
  assert.deepEqual(FOCUS_TERMINAL_STATES, [
    "COMPLETED",
    "ABANDONED",
    "EXPIRED",
  ]);
});

test("Study feature flags use release defaults and explicit overrides parse strictly", () => {
  assert.equal(DEFAULT_STUDY_FEATURE_FLAGS.FOCUS_HUB_ENABLED, true);
  assert.equal(DEFAULT_STUDY_FEATURE_FLAGS.STUDY_POINTS_ENABLED, true);
  assert.equal(DEFAULT_STUDY_FEATURE_FLAGS.MASTERY_ENABLED, true);
  assert.equal(DEFAULT_STUDY_FEATURE_FLAGS.STUDY_ANALYZER_ENABLED, true);
  assert.equal(DEFAULT_STUDY_FEATURE_FLAGS.GROUP_FOCUS_ENABLED, false);
  assert.equal(DEFAULT_STUDY_FEATURE_FLAGS.AI_STUDY_INSIGHTS_ENABLED, false);
  assert.equal(DEFAULT_STUDY_FEATURE_FLAGS.LEADERBOARD_D1_READ_ENABLED, false);

  assert.equal(parseStudyFeatureFlag("true"), true);
  assert.equal(parseStudyFeatureFlag(" ON "), true);
  assert.equal(parseStudyFeatureFlag("false"), false);
  assert.equal(parseStudyFeatureFlag("maybe"), false);
  assert.equal(parseStudyFeatureFlag(undefined), false);

  const defaults = getStudyFeatureFlags({});
  assert.deepEqual(defaults, DEFAULT_STUDY_FEATURE_FLAGS);

  const flags = getStudyFeatureFlags({
    FOCUS_HUB_ENABLED: "false",
    STUDY_POINTS_ENABLED: "0",
    AI_STUDY_INSIGHTS_ENABLED: "true",
  });
  assert.equal(flags.FOCUS_HUB_ENABLED, false);
  assert.equal(flags.STUDY_POINTS_ENABLED, false);
  assert.equal(flags.AI_STUDY_INSIGHTS_ENABLED, true);
  assert.equal(flags.GROUP_FOCUS_ENABLED, false);
});

test("Evidence and privacy classes contain only the frozen identifiers", () => {
  assert.deepEqual(EVIDENCE_CLASSES, [
    "UNVERIFIED_CLIENT",
    "CLIENT_OBSERVED",
    "SERVER_VALIDATED",
    "SERVER_DERIVED",
    "REALTIME_VERIFIED",
    "ADMIN_VERIFIED",
  ]);
  assert.equal(EVIDENCE_CLASS_RANK.SERVER_DERIVED, 3);
  assert.equal(EVIDENCE_CLASS_RANK.REALTIME_VERIFIED, 3);
  assert.equal(EVIDENCE_CLASS_RANK.ADMIN_VERIFIED, 4);
  assert.deepEqual(PRIVACY_CLASSES, [
    "PUBLIC",
    "PROFILE_PUBLIC",
    "PRIVATE_STUDY",
    "ADMIN_SECURITY",
    "SYSTEM_INTERNAL",
  ]);
});

test("Recall, points, mastery, idempotency, and leaderboard contracts are fixed", () => {
  assert.ok(RECALL_RESPONSE_STATUSES.includes("SKIPPED"));
  assert.deepEqual(POINT_CATEGORIES, [
    "FOCUS",
    "MASTERY",
    "PROGRESS",
    "CONSISTENCY",
  ]);
  assert.equal(POINT_CATEGORIES.includes("AI" as never), false);
  assert.deepEqual(MASTERY_STATES, [
    "NOT_STARTED",
    "STARTED",
    "LEARNING",
    "NEEDS_REVIEW",
    "GOOD",
    "MASTERED",
  ]);
  assert.equal(IDEMPOTENCY_SCOPES.length, 10);
  assert.deepEqual(IDEMPOTENCY_RESULTS, [
    "FIRST_SEEN",
    "REPLAY_SAME_PAYLOAD",
    "CONFLICTING_PAYLOAD",
  ]);
  assert.deepEqual(LEADERBOARD_PERIODS, [
    "WEEKLY",
    "MONTHLY",
    "SEMESTER",
    "ALL_TIME",
  ]);
  assert.equal(DEFAULT_LEADERBOARD_PERIOD, "WEEKLY");
});

test("Group Focus defaults are centralized and safe", () => {
  assert.equal(GROUP_FOCUS_CONFIG_DEFAULTS.defaultMaxRoomSize, 12);
  assert.equal(GROUP_FOCUS_CONFIG_DEFAULTS.absoluteSafetyCeiling, 25);
  assert.equal(
    GROUP_FOCUS_CONFIG_DEFAULTS.absoluteSafetyCeiling >=
      GROUP_FOCUS_CONFIG_DEFAULTS.defaultMaxRoomSize,
    true,
  );
  assert.equal(GROUP_FOCUS_CONFIG_DEFAULTS.reconnectGracePeriodSeconds, 90);
  assert.equal(GROUP_FOCUS_CONFIG_DEFAULTS.idleTimeoutSeconds, 15 * 60);
  assert.equal(
    GROUP_FOCUS_CONFIG_DEFAULTS.maximumRoomLifetimeSeconds,
    8 * 60 * 60,
  );
});