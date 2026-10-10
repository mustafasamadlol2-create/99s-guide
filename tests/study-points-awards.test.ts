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
import {
  loadFirstCorrectMcqSource,
  loadFirstRecalledFlashcardSource,
} from "../server/features/study-points/sources/learningActivity.js";

test("MCQ points require a server-validated correct answer", async () => {
  const event = {
    id: "event-1",
    source: "backend",
    evidenceClass: "SERVER_VALIDATED",
    occurredAt: new Date("2026-09-25T10:00:00.000Z"),
    payload: { correct: true },
  };
  const tx = {
    studyEvent: { findFirst: async () => event },
  } as never;
  const result = await loadFirstCorrectMcqSource(tx, "user-1", "mcq-1");
  assert.equal("source" in result, true);
  if ("source" in result) {
    assert.equal(result.source.sourceId, "mcq-1");
    assert.equal(result.source.actionType, "mcq.answer");
  }

  const incorrectTx = {
    studyEvent: {
      findFirst: async () => ({ ...event, payload: { correct: false } }),
    },
  } as never;
  assert.deepEqual(
    await loadFirstCorrectMcqSource(incorrectTx, "user-1", "mcq-1"),
    { reason: "INSUFFICIENT_EVIDENCE" },
  );
});

test("flashcard points require a server-validated successful recall rating", async () => {
  const tx = {
    studyEvent: {
      findFirst: async () => ({
        id: "event-1",
        source: "backend",
        evidenceClass: "SERVER_VALIDATED",
        occurredAt: new Date("2026-09-25T10:00:00.000Z"),
        payload: { quality: "GOOD" },
      }),
    },
  } as never;
  const result = await loadFirstRecalledFlashcardSource(tx, "user-1", "card-1");
  assert.equal("source" in result, true);
  if ("source" in result) {
    assert.equal(result.source.sourceId, "card-1");
    assert.equal(result.source.actionType, "flashcard.review");
  }
});

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

test("the rule registry only activates verified, capped learning sources", () => {
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
    "mcq.first_verified_correct",
    "flashcard.first_verified_recall",
    "recall.objective_correct",
  ]);
  assert.deepEqual(inactive, []);
  assert.equal(
    STUDY_POINTS_AWARD_RULES.find((rule) => rule.sourceType === "MCQ_ATTEMPT")?.category,
    "PROGRESS",
  );
  assert.equal(
    STUDY_POINTS_AWARD_RULES.find((rule) => rule.sourceType === "FLASHCARD_REVIEW")?.category,
    "PROGRESS",
  );
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

test("daily consistency replay ignores later growth in the same day's focus total", () => {
  const existing = {
    userId: "user-1",
    category: "CONSISTENCY",
    reasonCode: "consistency.verified_study_day",
    sourceType: "DAILY_CONSISTENCY",
    sourceId: "2026-09-25",
    ruleVersion: "daily-consistency-v1",
    effectiveAt: new Date("2026-09-24T21:00:00.000Z"),
    metadata: {
      baseRuleAmount: 5,
      awardedAmount: 5,
      BaghdadDate: "2026-09-25",
      canonicalDurationSeconds: 2_700,
    },
  };
  const expected = {
    userId: "user-1",
    category: "CONSISTENCY" as const,
    reasonCode: "consistency.verified_study_day",
    sourceType: "DAILY_CONSISTENCY" as const,
    sourceId: "2026-09-25",
    ruleVersion: "daily-consistency-v1",
    effectiveAt: new Date("2026-09-25T10:00:00.000Z"),
    baseRuleAmount: 5,
    canonicalDurationSeconds: 5_400,
    baghdadDate: "2026-09-25",
  };

  assert.equal(
    studyPointsExistingEntryMatchesRule(existing, expected, false),
    true,
  );
});