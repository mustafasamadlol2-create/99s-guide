import assert from "node:assert/strict";
import test from "node:test";
import {
  STUDY_POINTS_AWARD_RULES,
  focusCompletionAmount,
} from "../server/features/study-points/awardRules.js";
import { studyPointsBaghdadDate } from "../server/features/study-points/caps.js";
import {
  studyPointsAwardIdempotencyKey,
  studyPointsConsistencyIdempotencyKey,
  studyPointsExistingEntryMatchesRule,
} from "../server/features/study-points/idempotency.js";

test("Focus award tiers use exact second boundaries", () => {
  assert.deepEqual([
    focusCompletionAmount(599),
    focusCompletionAmount(600),
    focusCompletionAmount(1_499),
    focusCompletionAmount(1_500),
    focusCompletionAmount(2_699),
    focusCompletionAmount(2_700),
    focusCompletionAmount(3_599),
    focusCompletionAmount(3_600),
    focusCompletionAmount(5_399),
    focusCompletionAmount(5_400),
    focusCompletionAmount(-1),
    focusCompletionAmount(Number.MAX_SAFE_INTEGER + 1),
  ], [
    null,
    4,
    4,
    8,
    8,
    12,
    12,
    16,
    16,
    20,
    null,
    null,
  ]);
});

test("Baghdad logical dates change at Baghdad midnight", () => {
  assert.equal(
    studyPointsBaghdadDate(new Date("2026-09-24T20:59:59.999Z")),
    "2026-09-24",
  );
  assert.equal(
    studyPointsBaghdadDate(new Date("2026-09-24T21:00:00.000Z")),
    "2026-09-25",
  );
});

test("the rule registry keeps evidence-incomplete sources inactive", () => {
  const active = STUDY_POINTS_AWARD_RULES
    .filter((rule) => rule.status === "ACTIVE")
    .map((rule) => rule.reasonCode);
  const inactive = STUDY_POINTS_AWARD_RULES
    .filter((rule) => rule.status !== "ACTIVE")
    .map((rule) => [rule.sourceType, rule.status]);

  assert.deepEqual(active, [
    "focus.verified_completion",
    "group_focus.verified_participation",
    "group_focus.verified_social_bonus",
    "consistency.verified_study_day",
  ]);
  assert.deepEqual(inactive, [
    ["MCQ_ATTEMPT", "INACTIVE_UNSUPPORTED"],
    ["FLASHCARD_REVIEW", "INACTIVE_UNSUPPORTED"],
  ]);
});

test("source idempotency keys are stable and scoped to rule and source", () => {
  const base = {
    userId: "user-1",
    sourceType: "FOCUS_SESSION" as const,
    sourceId: "session-1",
    ruleVersion: "focus-completion-v1",
    reasonCode: "focus.verified_completion",
  };
  const key = studyPointsAwardIdempotencyKey(base);
  assert.equal(studyPointsAwardIdempotencyKey(base), key);
  assert.notEqual(studyPointsAwardIdempotencyKey({ ...base, sourceId: "session-2" }), key);
  assert.notEqual(studyPointsAwardIdempotencyKey({ ...base, userId: "user-2" }), key);
  assert.notEqual(studyPointsAwardIdempotencyKey({ ...base, ruleVersion: "focus-v2" }), key);

  const dailyKey = studyPointsConsistencyIdempotencyKey({
    userId: "user-1",
    baghdadDate: "2026-09-25",
    ruleVersion: "daily-consistency-v1",
  });
  assert.equal(dailyKey, studyPointsConsistencyIdempotencyKey({
    userId: "user-1",
    baghdadDate: "2026-09-25",
    ruleVersion: "daily-consistency-v1",
  }));
  assert.notEqual(dailyKey, studyPointsConsistencyIdempotencyKey({
    userId: "user-1",
    baghdadDate: "2026-09-26",
    ruleVersion: "daily-consistency-v1",
  }));
});

test("an existing partial-cap award replays only for the same canonical rule data", () => {
  const existing = {
    userId: "user-1",
    category: "FOCUS",
    reasonCode: "focus.verified_completion",
    sourceType: "FOCUS_SESSION",
    sourceId: "session-1",
    ruleVersion: "focus-completion-v1",
    effectiveAt: new Date("2026-09-24T21:00:00.000Z"),
    metadata: {
      baseRuleAmount: 12,
      awardedAmount: 3,
      BaghdadDate: "2026-09-25",
      canonicalDurationSeconds: 2_700,
    },
  };
  const expected = {
    userId: "user-1",
    category: "FOCUS" as const,
    reasonCode: "focus.verified_completion",
    sourceType: "FOCUS_SESSION" as const,
    sourceId: "session-1",
    ruleVersion: "focus-completion-v1",
    effectiveAt: new Date("2026-09-24T21:00:00.000Z"),
    baseRuleAmount: 12,
    canonicalDurationSeconds: 2_700,
    baghdadDate: "2026-09-25",
  };
  assert.equal(studyPointsExistingEntryMatchesRule(existing, expected), true);
  assert.equal(studyPointsExistingEntryMatchesRule(existing, {
    ...expected,
    canonicalDurationSeconds: 3_600,
  }), false);
});