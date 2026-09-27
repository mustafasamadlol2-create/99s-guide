import assert from "node:assert/strict";
import test from "node:test";
import {
  compareMasteryD1Rows,
} from "../server/features/mastery/d1Reconciliation.js";
import {
  lectureMasteryD1Payload,
  lectureRetentionD1Payload,
} from "../server/features/mastery/d1Projection.js";

const now = new Date("2026-09-27T12:00:00.000Z");
const later = new Date("2026-09-28T12:00:00.000Z");

function canonicalMastery() {
  return {
    userId: "user-1",
    lectureId: "lecture-1",
    state: "NEEDS_REVIEW",
    evidenceScore: 42,
    evidenceCount: 5,
    objectiveAttemptCount: 4,
    objectiveCorrectCount: 3,
    objectiveIncorrectCount: 1,
    flashcardReviewCount: 2,
    flashcardRememberedCount: 1,
    flashcardNotRememberedCount: 1,
    recallObjectiveAttemptCount: 1,
    recallObjectiveCorrectCount: 1,
    recallObjectiveIncorrectCount: 0,
    meaningfulFocusSessionCount: 2,
    meaningfulFocusSeconds: 1200,
    lastStudyEvidenceAt: now,
    lastObjectiveEvidenceAt: now,
    lastRecallEvidenceAt: null,
    ruleVersion: "mastery-v1",
    revision: 7,
    lastEvaluatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function canonicalRetention() {
  return {
    userId: "user-1",
    lectureId: "lecture-1",
    sourceMasteryRevision: 7,
    sourceMasteryRuleVersion: "mastery-v1",
    effectiveMasteryState: "NEEDS_REVIEW",
    retentionScore: 61,
    reviewState: "DUE",
    reviewUrgencyScore: 20,
    retentionAnchorAt: now,
    nextReviewAt: now,
    nextEvaluationAt: later,
    lastPositiveMemoryEvidenceAt: now,
    lastNegativeMemoryEvidenceAt: null,
    lastForgettingEvidenceAt: null,
    objectiveForgettingItemCount: 0,
    selfReportedForgettingItemCount: 0,
    forgettingEvidenceKind: "NONE",
    ruleVersion: "retention-v1",
    revision: 3,
    lastEvaluatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function projectedRows() {
  const mastery = canonicalMastery();
  const retention = canonicalRetention();
  return {
    mastery,
    retention,
    d1Mastery: lectureMasteryD1Payload(mastery as any, "subject-1"),
    d1Retention: lectureRetentionD1Payload(retention as any),
  };
}

test("reconciliation accepts matching canonical and D1 projection rows", () => {
  const rows = projectedRows();
  assert.deepEqual(compareMasteryD1Rows({
    ...rows,
    now,
    subjectId: "subject-1",
  }), []);
});

test("reconciliation identifies missing and orphaned D1 rows", () => {
  const rows = projectedRows();
  assert.deepEqual(compareMasteryD1Rows({
    mastery: rows.mastery,
    retention: rows.retention,
    d1Mastery: null,
    d1Retention: null,
    now,
    subjectId: "subject-1",
  }), ["MISSING_MASTERY", "MISSING_RETENTION"]);

  assert.deepEqual(compareMasteryD1Rows({
    mastery: null,
    retention: null,
    d1Mastery: rows.d1Mastery,
    d1Retention: rows.d1Retention,
    now,
    subjectId: "subject-1",
  }), ["ORPHAN_MASTERY", "ORPHAN_RETENTION"]);
});

test("reconciliation separates revision, rule, payload and time-stale mismatches", () => {
  const rows = projectedRows();
  const mastery = { ...rows.d1Mastery, revision: 6, rule_version: "old-mastery", evidence_count: 9 };
  const retention = { ...rows.d1Retention, revision: 2, rule_version: "old-retention" };
  const codes = compareMasteryD1Rows({
    ...rows,
    d1Mastery: mastery,
    d1Retention: retention,
    now: new Date("2026-09-29T00:00:00.000Z"),
    subjectId: "subject-1",
  });
  assert.ok(codes.includes("MASTERY_REVISION_MISMATCH"));
  assert.ok(codes.includes("MASTERY_RULE_MISMATCH"));
  assert.ok(codes.includes("RETENTION_REVISION_MISMATCH"));
  assert.ok(codes.includes("RETENTION_RULE_MISMATCH"));
  assert.ok(codes.includes("PAYLOAD_MISMATCH"));
  assert.ok(codes.includes("RETENTION_TIME_STALE"));
});