import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveChallengeProgressStatus,
} from "../server/features/gamification/challengeRefresh.js";
import {
  GAMIFICATION_V1_RULE_SET_VERSION,
  getGamificationDefinitionBundle,
} from "../server/features/gamification/index.js";

const startsAt = new Date("2026-09-27T21:00:00.000Z");
const endsAt = new Date("2026-10-04T21:00:00.000Z");

test("v1 Challenge contract is small, private, windowed, and AUTO enrolled", () => {
  const bundle = getGamificationDefinitionBundle(GAMIFICATION_V1_RULE_SET_VERSION);
  assert.deepEqual(
    bundle.challengeDefinitionContracts.map((definition) => [
      definition.id,
      definition.metricId,
      definition.target,
      definition.enrollmentPolicy,
      definition.windowPolicy,
      definition.visibility,
    ]),
    [
      [
        "challenge.focus.weekly_3_sessions",
        "focus.completed_sessions",
        3,
        "AUTO",
        "WEEKLY",
        "PRIVATE_STUDY",
      ],
      [
        "challenge.focus.weekly_120_minutes",
        "focus.verified_seconds",
        7200,
        "AUTO",
        "WEEKLY",
        "PRIVATE_STUDY",
      ],
      [
        "challenge.consistency.weekly_3_days",
        "consistency.qualifying_days",
        3,
        "AUTO",
        "WEEKLY",
        "PRIVATE_STUDY",
      ],
      [
        "challenge.group_focus.weekly_2_runs",
        "group_focus.completed_runs",
        2,
        "AUTO",
        "WEEKLY",
        "PRIVATE_STUDY",
      ],
    ],
  );
});

test("window metrics determine completion and expiry with permanent completion", () => {
  const base = {
    currentValue: 2,
    targetValue: 3,
    asOf: new Date("2026-10-02T12:00:00.000Z"),
    endsAt,
  };
  assert.equal(
    deriveChallengeProgressStatus({ ...base, currentStatus: "ACTIVE" }),
    "ACTIVE",
  );
  assert.equal(
    deriveChallengeProgressStatus({
      ...base,
      currentStatus: "ACTIVE",
      asOf: endsAt,
    }),
    "EXPIRED",
  );
  assert.equal(
    deriveChallengeProgressStatus({
      ...base,
      currentStatus: "ACTIVE",
      currentValue: 3,
    }),
    "COMPLETED",
  );
  assert.equal(
    deriveChallengeProgressStatus({
      ...base,
      currentStatus: "ACTIVE",
      currentValue: 3,
      asOf: endsAt,
    }),
    "COMPLETED",
  );
  assert.equal(
    deriveChallengeProgressStatus({
      ...base,
      currentStatus: "COMPLETED",
      currentValue: 0,
      asOf: endsAt,
    }),
    "COMPLETED",
  );
  assert.equal(
    deriveChallengeProgressStatus({
      ...base,
      currentStatus: "EXPIRED",
      currentValue: 3,
      asOf: endsAt,
    }),
    "COMPLETED",
  );
  assert.equal(
    deriveChallengeProgressStatus({
      ...base,
      currentStatus: "LEFT",
      currentValue: 3,
      asOf: endsAt,
    }),
    "LEFT",
  );
});

test("invalid progress values fail closed", () => {
  assert.throws(() => deriveChallengeProgressStatus({
    currentStatus: "ACTIVE",
    currentValue: -1,
    targetValue: 3,
    asOf: startsAt,
    endsAt,
  }));
  assert.throws(() => deriveChallengeProgressStatus({
    currentStatus: "ACTIVE",
    currentValue: 0,
    targetValue: 0,
    asOf: startsAt,
    endsAt,
  }));
});