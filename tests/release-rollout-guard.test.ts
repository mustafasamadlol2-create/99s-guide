import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRolloutStatus,
  reviewRolloutStage,
  summarizePrompt51Manifest,
} from "../server/release/rolloutGuard.js";
import {
  isRuntimeEnforcedStudyFlag,
  ROLLOUT_STAGES,
} from "../server/release/stageDefinitions.js";

function passingCertification() {
  return {
    schemaVersion: 1,
    allRequiredDeviceChecksPassed: true,
    productionRolloutAllowed: true,
    environment: { safeDisposableDatabase: true },
    testCaseTotals: { blockedOrSkippedForMissingDisposableDatabase: 0 },
    results: [
      { platform: "iPhone", scenario: "device journey", status: "PASS" },
      { platform: "iPad", scenario: "tablet journey", status: "PASS" },
      { platform: "PWA", scenario: "install and offline", status: "PASS" },
    ],
  };
}

test("Prompt 51 manifest counts statuses and fails closed on incomplete required checks", () => {
  const summary = summarizePrompt51Manifest({
    schemaVersion: 1,
    allRequiredDeviceChecksPassed: false,
    productionRolloutAllowed: false,
    environment: { safeDisposableDatabase: false },
    testCaseTotals: { blockedOrSkippedForMissingDisposableDatabase: 75 },
    results: [
      { platform: "iPhone", scenario: "study journey", status: "NOT_RUN" },
      { platform: "iPad", scenario: "tablet study", status: "NOT_RUN" },
      { platform: "PWA", scenario: "offline update", status: "NOT_RUN" },
      { platform: "Web", scenario: "interactive E2E", status: "NOT_RUN" },
      { platform: "Study domain", scenario: "database integration", status: "BLOCKED" },
    ],
  });

  assert.equal(summary.valid, true);
  assert.deepEqual(summary.counts, {
    PASS: 0,
    FAIL: 0,
    NOT_RUN: 4,
    BLOCKED: 1,
    NOT_APPLICABLE: 0,
  });
  assert.deepEqual(
    summary.notRunClassification.map((item) => item.classification),
    [
      "REQUIRED_BEFORE_ROLLOUT",
      "REQUIRED_BEFORE_ROLLOUT",
      "REQUIRED_BEFORE_ROLLOUT",
      "OPTIONAL_ENVIRONMENT_LIMITATION",
    ],
  );
  assert.ok(summary.blockers.includes("REQUIRED_DEVICE_CERTIFICATION_INCOMPLETE"));
  assert.ok(summary.blockers.includes("DATABASE_GATED_CERTIFICATION_INCOMPLETE"));
});

test("PREPARE_ONLY status never executes or writes and preserves the required blocker", () => {
  const prompt51 = summarizePrompt51Manifest({
    schemaVersion: 1,
    allRequiredDeviceChecksPassed: false,
    productionRolloutAllowed: false,
    environment: { safeDisposableDatabase: false },
    testCaseTotals: { blockedOrSkippedForMissingDisposableDatabase: 75 },
    results: [
      { platform: "iPhone", scenario: "device", status: "NOT_RUN" },
      { platform: "iPad", scenario: "device", status: "NOT_RUN" },
      { platform: "PWA", scenario: "runtime", status: "NOT_RUN" },
    ],
  });
  const status = buildRolloutStatus({
    prompt51,
    releaseGateStatus: "NOT_RUN",
  });

  assert.equal(status.mode, "PREPARE_ONLY");
  assert.equal(status.status, "BLOCKED — REQUIRED DEVICE CERTIFICATION INCOMPLETE");
  assert.equal(status.productionExecutionSupported, false);
  assert.equal(status.writesPerformed, 0);
  assert.ok(status.stages.every((stage) => stage.status === "BLOCKED"));
});

test("stage review requires explicit dependencies and never performs activation", () => {
  const prompt51 = summarizePrompt51Manifest(passingCertification());
  const review = reviewRolloutStage({
    stageId: "ai-insights-ask-data",
    completedStages: [],
    prompt51,
    releaseGateStatus: "READY",
  });

  assert.equal(review.readyForOperatorReview, false);
  assert.ok(review.blockers.includes("STAGE_DEPENDENCY_INCOMPLETE:study-analyzer"));
  assert.equal(review.executed, false);
  assert.equal(review.writesPerformed, 0);
});

test("a ready stage remains a human decision; no next stage is auto-completed", () => {
  const prompt51 = summarizePrompt51Manifest(passingCertification());
  const review = reviewRolloutStage({
    stageId: "solo-focus",
    completedStages: ["dark-deployment", "internal-smoke"],
    prompt51,
    releaseGateStatus: "READY",
  });

  assert.equal(review.readyForOperatorReview, true);
  assert.equal(review.executed, false);
  assert.equal(review.writesPerformed, 0);
  assert.equal(
    ROLLOUT_STAGES.find((stage) => stage.id === "group-focus")?.dependsOn.includes("solo-focus"),
    true,
  );
});

test("unknown certification and stage inputs fail closed", () => {
  assert.equal(summarizePrompt51Manifest(null).valid, false);
  const invalidStage = reviewRolloutStage({
    stageId: "not-a-stage",
    prompt51: summarizePrompt51Manifest(passingCertification()),
    releaseGateStatus: "READY",
  });
  assert.equal(invalidStage.readyForOperatorReview, false);
  assert.ok(invalidStage.blockers.includes("UNKNOWN_ROLLOUT_STAGE"));
});

test("release warnings require an explicit non-critical review", () => {
  const prompt51 = summarizePrompt51Manifest(passingCertification());
  const unreviewed = reviewRolloutStage({
    stageId: "dark-deployment",
    prompt51,
    releaseGateStatus: "READY_WITH_WARNINGS",
  });
  const reviewed = reviewRolloutStage({
    stageId: "dark-deployment",
    prompt51,
    releaseGateStatus: "READY_WITH_WARNINGS",
    nonCriticalWarningsReviewed: true,
  });

  assert.ok(unreviewed.blockers.includes("PROMPT50_WARNINGS_NOT_REVIEWED_AS_NON_CRITICAL"));
  assert.equal(reviewed.readyForOperatorReview, true);
});

test("declared but unenforced flags are not represented as effective kill switches", () => {
  const prompt51 = summarizePrompt51Manifest(passingCertification());
  const points = reviewRolloutStage({
    stageId: "points-gamification",
    completedStages: ["solo-focus"],
    prompt51,
    releaseGateStatus: "READY",
  });
  const enforcement = Object.fromEntries(
    points.flags.map((flag) => [flag.name, flag.runtimeEnforced]),
  );

  assert.equal(enforcement.STUDY_POINTS_ENABLED, false);
  assert.equal(enforcement.GAMIFICATION_ENABLED, false);
  assert.equal(isRuntimeEnforcedStudyFlag("STUDY_ANALYZER_ENABLED"), true);
});