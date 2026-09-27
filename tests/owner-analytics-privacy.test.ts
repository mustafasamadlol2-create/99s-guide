import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOwnerAnalyticsPrivacy,
  MIN_OWNER_ANALYTICS_CONTRIBUTORS,
  MIN_OWNER_ANALYTICS_INTERACTIONS,
  OWNER_ANALYTICS_PRIVACY_VERSION,
} from "../server/features/owner-analytics/privacy.js";
import { rateMetric } from "../server/features/owner-analytics/rate.js";
import { createOwnerAcademicAggregateFixture } from "./owner-analytics-fixtures.js";

function transform(
  aggregate = createOwnerAcademicAggregateFixture(),
  scopePopulation = aggregate.population.eligibleStudents,
) {
  return applyOwnerAnalyticsPrivacy({
    aggregate,
    policyVersion: OWNER_ANALYTICS_PRIVACY_VERSION,
    scopePopulation,
  });
}

test("privacy policy constants and exact-zero disclosure are explicit", () => {
  const safe = transform();
  assert.equal(MIN_OWNER_ANALYTICS_CONTRIBUTORS, 10);
  assert.equal(MIN_OWNER_ANALYTICS_INTERACTIONS, 20);
  assert.equal(safe.privacy.policyVersion, "owner-analytics-privacy-v1");
  assert.equal(safe.cohort.activeStudyUsers.status, "NO_DATA");
  assert.deepEqual(safe.cohort.activeStudyUsers.value, 0);
  assert.equal(safe.cohort.analyticsStatus, "NO_DATA");
  assert.equal(safe.cohort.activityWindowMetrics.resources.launches.status, "UNAVAILABLE");
  assert.equal(safe.cohort.activityWindowMetrics.resources.handoffs.status, "NO_DATA");
});

test("1 and 9 contributors have identical hidden shapes; 10 is visible", () => {
  function withActiveUsers(users: number) {
    const aggregate = createOwnerAcademicAggregateFixture();
    aggregate.population.activeStudyUsers = users;
    aggregate.privacyMetadata.cohort.activity.activeStudyUsers = users;
    return transform(aggregate);
  }

  const one = withActiveUsers(1);
  const nine = withActiveUsers(9);
  const ten = withActiveUsers(10);
  assert.deepEqual(one.cohort.activeStudyUsers, {
    status: "SUPPRESSED",
    value: null,
    contributingUsers: null,
    reason: "LOW_SAMPLE",
  });
  assert.deepEqual(nine.cohort.activeStudyUsers, one.cohort.activeStudyUsers);
  assert.deepEqual(ten.cohort.activeStudyUsers, {
    status: "VISIBLE",
    value: 10,
    contributingUsers: 10,
  });
});

test("performance metrics require both contributor and interaction thresholds", () => {
  const belowBoundary = createOwnerAcademicAggregateFixture();
  belowBoundary.activityWindowMetrics.mcq = {
    objectiveAttempts: 19,
    objectiveCorrect: 12,
    objectiveIncorrect: 7,
    uniqueUsers: 10,
    distinctItemsAttempted: 9,
    accuracyRate: rateMetric(12, 19),
  };
  belowBoundary.privacyMetadata.cohort.activity.mcqUsers = 10;

  const atBoundary = createOwnerAcademicAggregateFixture();
  atBoundary.activityWindowMetrics.mcq = {
    objectiveAttempts: 20,
    objectiveCorrect: 12,
    objectiveIncorrect: 8,
    uniqueUsers: 10,
    distinctItemsAttempted: 9,
    accuracyRate: rateMetric(12, 20),
  };
  atBoundary.privacyMetadata.cohort.activity.mcqUsers = 10;

  assert.deepEqual(transform(belowBoundary).cohort.activityWindowMetrics.mcq, {
    status: "SUPPRESSED",
    value: null,
    contributingUsers: null,
    reason: "LOW_INTERACTION_COUNT",
  });
  assert.equal(transform(atBoundary).cohort.activityWindowMetrics.mcq.status, "VISIBLE");
  assert.equal(transform(atBoundary).cohort.activityWindowMetrics.mcq.value?.objectiveAttempts, 20);
});

test("Focus average requires ten users and twenty meaningful sessions", () => {
  const aggregate = createOwnerAcademicAggregateFixture();
  aggregate.activityWindowMetrics.focus = {
    meaningfulSessionCount: 20,
    verifiedStudySeconds: 18_000,
    uniqueUsers: 10,
    averageMeaningfulSessionSeconds: 900,
    averageMeaningfulSessionSecondsDenominator: 20,
  };
  aggregate.privacyMetadata.cohort.activity.focusUsers = 10;
  assert.deepEqual(
    transform(aggregate).cohort.activityWindowMetrics.focusAverageMeaningfulSessionSeconds,
    { status: "VISIBLE", value: 900, contributingUsers: 10 },
  );

  aggregate.activityWindowMetrics.focus.meaningfulSessionCount = 19;
  aggregate.activityWindowMetrics.focus.averageMeaningfulSessionSecondsDenominator = 19;
  assert.equal(
    transform(aggregate).cohort.activityWindowMetrics.focusAverageMeaningfulSessionSeconds.status,
    "SUPPRESSED",
  );
});

test("low population overrides malformed activity values", () => {
  const aggregate = createOwnerAcademicAggregateFixture();
  aggregate.population.activeStudyUsers = 20;
  aggregate.activityWindowMetrics.mcq = {
    objectiveAttempts: 20,
    objectiveCorrect: 20,
    objectiveIncorrect: 0,
    uniqueUsers: 20,
    distinctItemsAttempted: 20,
    accuracyRate: rateMetric(20, 20),
  };
  aggregate.privacyMetadata.cohort.activity.activeStudyUsers = 20;
  aggregate.privacyMetadata.cohort.activity.mcqUsers = 20;
  const safe = transform(aggregate, 8);
  assert.equal(safe.cohort.analyticsStatus, "LOW_POPULATION");
  assert.equal(safe.cohort.eligibleStudents, 8);
  assert.equal(safe.cohort.activeStudyUsers.status, "SUPPRESSED");
  assert.equal(safe.cohort.activityWindowMetrics.mcq.status, "SUPPRESSED");
  assert.equal(safe.cohort.currentStateMetrics.status, "SUPPRESSED");
});

test("sensitive distributions suppress as one unit when any non-zero bucket is small", () => {
  const aggregate = createOwnerAcademicAggregateFixture();
  const state = aggregate.currentStateMetrics;
  state.mastery.trackedUserLecturePairs = 20;
  state.mastery.baseDistribution.MASTERED = 19;
  state.mastery.baseDistribution.LEARNING = 1;
  state.mastery.freshEffectiveDistribution.MASTERED = 10;
  state.retention.freshRows = 10;
  state.retention.reviewDistribution.FRESH = 10;
  state.retention.forgettingEvidenceDistribution.NONE = 10;
  aggregate.privacyMetadata.cohort.currentState.trackedUsers = 20;
  aggregate.privacyMetadata.cohort.currentState.baseMasteryBucketUsers.MASTERED = 19;
  aggregate.privacyMetadata.cohort.currentState.baseMasteryBucketUsers.LEARNING = 1;
  aggregate.privacyMetadata.cohort.currentState.effectiveMasteryBucketUsers.MASTERED = 10;
  aggregate.privacyMetadata.cohort.currentState.freshRetentionUsers = 10;
  aggregate.privacyMetadata.cohort.currentState.reviewBucketUsers.FRESH = 10;
  aggregate.privacyMetadata.cohort.currentState.forgettingBucketUsers.NONE = 10;

  const safe = transform(aggregate);
  assert.deepEqual(safe.cohort.currentStateMetrics, {
    status: "SUPPRESSED",
    value: null,
    contributingUsers: null,
    reason: "DISTRIBUTION_PRIVACY",
  });
  const serialized = JSON.stringify(safe.cohort.currentStateMetrics);
  assert.doesNotMatch(serialized, /trackedUserLecturePairs|MASTERED|LEARNING|freshRows/);
});

test("all-safe and zero-sample sensitive distributions disclose without residual fields", () => {
  const aggregate = createOwnerAcademicAggregateFixture();
  const state = aggregate.currentStateMetrics;
  state.mastery.trackedUserLecturePairs = 20;
  state.mastery.baseDistribution.MASTERED = 20;
  state.mastery.freshEffectiveDistribution.MASTERED = 10;
  state.mastery.freshRetentionRows = 10;
  state.retention.freshRows = 10;
  state.retention.missingRows = 10;
  state.retention.reviewDistribution.FRESH = 10;
  state.retention.forgettingEvidenceDistribution.NONE = 10;
  aggregate.privacyMetadata.cohort.currentState.trackedUsers = 20;
  aggregate.privacyMetadata.cohort.currentState.baseMasteryBucketUsers.MASTERED = 20;
  aggregate.privacyMetadata.cohort.currentState.effectiveMasteryBucketUsers.MASTERED = 10;
  aggregate.privacyMetadata.cohort.currentState.freshRetentionUsers = 10;
  aggregate.privacyMetadata.cohort.currentState.missingRetentionUsers = 10;
  aggregate.privacyMetadata.cohort.currentState.reviewBucketUsers.FRESH = 10;
  aggregate.privacyMetadata.cohort.currentState.forgettingBucketUsers.NONE = 10;

  const safe = transform(aggregate);
  assert.equal(safe.cohort.currentStateMetrics.status, "VISIBLE");
  assert.equal(
    safe.cohort.currentStateMetrics.value?.mastery.baseDistribution.MASTERED,
    20,
  );

  const empty = transform().cohort.currentStateMetrics;
  assert.equal(empty.status, "NO_DATA");
  assert.equal(empty.contributingUsers, 0);
});

test("optional metric suppression leaves the rest visible and marks partial status", () => {
  const aggregate = createOwnerAcademicAggregateFixture();
  aggregate.population.activeStudyUsers = 10;
  aggregate.privacyMetadata.cohort.activity.activeStudyUsers = 10;
  aggregate.activityWindowMetrics.focus = {
    meaningfulSessionCount: 20,
    verifiedStudySeconds: 10_000,
    uniqueUsers: 10,
    averageMeaningfulSessionSeconds: 500,
    averageMeaningfulSessionSecondsDenominator: 20,
  };
  aggregate.privacyMetadata.cohort.activity.focusUsers = 10;
  aggregate.activityWindowMetrics.mcq = {
    objectiveAttempts: 19,
    objectiveCorrect: 10,
    objectiveIncorrect: 9,
    uniqueUsers: 10,
    distinctItemsAttempted: 12,
    accuracyRate: rateMetric(10, 19),
  };
  aggregate.privacyMetadata.cohort.activity.mcqUsers = 10;

  const safe = transform(aggregate);
  assert.equal(safe.cohort.activeStudyUsers.status, "VISIBLE");
  assert.equal(safe.cohort.activityWindowMetrics.focus.status, "VISIBLE");
  assert.equal(safe.cohort.activityWindowMetrics.mcq.status, "SUPPRESSED");
  assert.equal(safe.cohort.analyticsStatus, "PARTIALLY_SUPPRESSED");
});

test("safe DTO is deterministic and excludes raw internal metadata", () => {
  const aggregate = createOwnerAcademicAggregateFixture();
  const first = transform(aggregate);
  const second = transform(aggregate);
  assert.deepEqual(second, first);
  assert.doesNotMatch(JSON.stringify(first), /privacyMetadata|user_id|userId|attemptId/);
});