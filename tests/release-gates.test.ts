import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_STUDY_FEATURE_FLAGS,
} from "../server/features/study-core/featureFlags.js";
import {
  buildReleaseReport,
  evaluateOutboxReleaseGate,
  evaluateStudyCohortAuditCounts,
  validateFeatureConfiguration,
  validateTargetDatabaseUrl,
} from "../server/observability/releaseGates.js";
import { loadStudyReleaseProfile } from "../server/observability/releaseProfile.js";

test("release report treats unknown gates as warnings rather than healthy passes", () => {
  const report = buildReleaseReport({
    target: "local",
    mode: "fast",
    gates: [
      { gate: "known", status: "PASS", code: "OK", message: "passed" },
      { gate: "unknown", status: "WARN", code: "UNKNOWN", message: "not probed" },
    ],
  });
  assert.equal(report.status, "READY_WITH_WARNINGS");
  assert.equal(report.writeOperationsPerformed, 0);
});

test("impossible feature combinations fail release validation", () => {
  const flags: Record<string, boolean> = {
    ...DEFAULT_STUDY_FEATURE_FLAGS,
    ASK_MY_STUDY_DATA_AI_ENABLED: true,
  };
  const result = validateFeatureConfiguration(flags, {});
  assert.equal(result.status, "FAIL");
  assert.match(result.message, /requires Ask My Study Data/u);
});

test("Prompt 52 frontend flags require matching backend gates and Group Focus configuration", () => {
  const disabledResult = validateFeatureConfiguration(
    { ...DEFAULT_STUDY_FEATURE_FLAGS },
    {
      VITE_FOCUS_HUB_V2_ENABLED: "true",
      VITE_GROUP_FOCUS_FRONTEND_ENABLED: "true",
      VITE_SPACED_RECALL_FRONTEND_ENABLED: "true",
      VITE_STUDY_ANALYZER_FRONTEND_ENABLED: "true",
      VITE_STUDY_INSIGHTS_FRONTEND_ENABLED: "true",
      VITE_ASK_MY_STUDY_DATA_FRONTEND_ENABLED: "true",
      VITE_OWNER_ANALYTICS_FRONTEND_ENABLED: "true",
    },
  );
  assert.equal(disabledResult.status, "FAIL");
  assert.match(disabledResult.message, /Focus Hub frontend/u);
  assert.match(disabledResult.message, /Ask My Study Data frontend/u);
  assert.match(disabledResult.message, /realtime Worker URL/u);

  const enabledResult = validateFeatureConfiguration(
    {
      ...DEFAULT_STUDY_FEATURE_FLAGS,
      FOCUS_HUB_ENABLED: true,
      GROUP_FOCUS_ENABLED: true,
      SPACED_RECALL_ENABLED: true,
      STUDY_ANALYZER_ENABLED: true,
      AI_STUDY_INSIGHTS_ENABLED: true,
      ASK_MY_STUDY_DATA_ENABLED: true,
      OWNER_STUDY_ANALYTICS_ENABLED: true,
    },
    {
      VITE_FOCUS_HUB_V2_ENABLED: "true",
      VITE_GROUP_FOCUS_FRONTEND_ENABLED: "true",
      VITE_GROUP_FOCUS_WORKER_URL: "https://focus-worker.example.test",
      VITE_SPACED_RECALL_FRONTEND_ENABLED: "true",
      VITE_STUDY_ANALYZER_FRONTEND_ENABLED: "true",
      VITE_STUDY_INSIGHTS_FRONTEND_ENABLED: "true",
      VITE_ASK_MY_STUDY_DATA_FRONTEND_ENABLED: "true",
      VITE_OWNER_ANALYTICS_FRONTEND_ENABLED: "true",
    },
  );
  assert.equal(enabledResult.status, "PASS");
});

test("database target validation accepts only explicit local or staging addresses", () => {
  assert.deepEqual(
    validateTargetDatabaseUrl({
      target: "local",
      value: "postgresql://user:password@127.0.0.1:5432/study",
    }),
    { ok: true, value: "postgresql://user:password@127.0.0.1:5432/study" },
  );
  assert.deepEqual(
    validateTargetDatabaseUrl({
      target: "staging",
      value: "postgresql://user:password@localhost:5432/study",
    }),
    { ok: false, reason: "STAGING_TARGET_REQUIRES_NONLOCAL_DATABASE" },
  );
  assert.deepEqual(
    validateTargetDatabaseUrl({
      target: "staging",
      value: "postgresql://user:password@production-db.example.test/study",
    }),
    { ok: false, reason: "PRODUCTION_DATABASE_HOST_REJECTED" },
  );
  assert.deepEqual(
    validateTargetDatabaseUrl({ target: "local", value: undefined }),
    { ok: true, value: null },
  );
});

test("outbox release gate fails on blocked work and warns without a threshold", () => {
  assert.equal(
    evaluateOutboxReleaseGate({
      pending: 1,
      blocked: 1,
      poison: 0,
      highAttempts: 0,
      maxPending: 10,
    }).status,
    "FAIL",
  );
  assert.equal(
    evaluateOutboxReleaseGate({
      pending: 0,
      blocked: 0,
      poison: 0,
      highAttempts: 0,
    }).status,
    "WARN",
  );
  assert.equal(
    evaluateOutboxReleaseGate({
      pending: 4,
      blocked: 0,
      poison: 0,
      highAttempts: 0,
      maxPending: 3,
    }).status,
    "FAIL",
  );
});

test("cohort audit gates pass only when aggregate invariant and drift counts are zero", () => {
  const cleanCounts = {
    zeroValueEntries: 0n,
    invalidCategories: 0n,
    invalidReversals: 0n,
    duplicateSourceAwards: 0n,
    duplicateConsistencyAwards: 0n,
    duplicateLegacyBaselines: 0n,
    categoryCapViolations: 0n,
    totalCapViolations: 0n,
    socialBonusCapViolations: 0n,
    projectionDriftRows: 0n,
  };
  assert.deepEqual(
    evaluateStudyCohortAuditCounts(cleanCounts).map((gate) => gate.status),
    ["PASS", "PASS"],
  );
  assert.deepEqual(
    evaluateStudyCohortAuditCounts({
      ...cleanCounts,
      invalidReversals: 1n,
      projectionDriftRows: 2n,
    }).map((gate) => gate.status),
    ["FAIL", "FAIL"],
  );
});

test("release profile accepts only known boolean flags", async () => {
  const directory = await mkdtemp(join(tmpdir(), "study-release-profile-"));
  const valid = join(directory, "valid.json");
  const invalid = join(directory, "invalid.json");
  try {
    await writeFile(valid, JSON.stringify({
      name: "test",
      features: { STUDY_EVENTS_ENABLED: true },
    }));
    const profile = await loadStudyReleaseProfile(valid, {});
    assert.equal(profile.source, "file");
    assert.equal(profile.flags.STUDY_EVENTS_ENABLED, true);
    assert.equal(profile.flags.GROUP_FOCUS_ENABLED, false);

    await writeFile(invalid, JSON.stringify({
      name: "test",
      features: { UNKNOWN_SECRET_FIELD: "do-not-accept" },
    }));
    await assert.rejects(loadStudyReleaseProfile(invalid, {}), /unknown Study Engine feature/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});