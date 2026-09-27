import test from "node:test";
import assert from "node:assert/strict";
import { masterySummaryDto, validMasteryCacheShape } from "../server/features/mastery/privateDashboard.ts";
import { validateMasteryQuery } from "../server/routes/mastery.ts";

const userId = "user-1";
const metadata = {
  schema_version: "mastery-private-cache-v1",
  state: { user_id: userId, mastery_watermark: "4", retention_watermark: "8", deleted_at: null },
  totals: { total: 1, byState: { MASTERED: 1 } },
  counts: { mastery_count: 1, retention_count: 1, unsupported_rule_count: 0, min_next_evaluation_at: null },
  due: [],
  subjectAggregates: [],
};

test("mastery cache accepts complete fresh scoped metadata and rejects malformed/stale", () => {
  assert.equal(validMasteryCacheShape(metadata, userId), true);
  assert.equal(validMasteryCacheShape({ ...metadata, schema_version: "wrong" }, userId), false);
  assert.equal(validMasteryCacheShape({ ...metadata, state: { ...metadata.state, user_id: "other" } }, userId), false);
  assert.equal(validMasteryCacheShape({ ...metadata, counts: { ...metadata.counts, min_next_evaluation_at: "2000-01-01T00:00:00.000Z" } }, userId), false);
  assert.equal(validMasteryCacheShape({ ...metadata, state: { ...metadata.state, deleted_at: "now" } }, userId), false);
});

test("summary DTO contains no projection scores or raw evidence", () => {
  const dto = masterySummaryDto({
    lecture_id: "lecture-1", subject_id: "anatomy", state: "LEARNING",
    effective_mastery_state: "NEEDS_REVIEW", review_state: "DUE",
    next_review_at: null, last_evaluated_at: "2025-01-01T00:00:00.000Z",
    objective_attempt_count: 2, objective_correct_count: 1, flashcard_review_count: 3,
    evidence_score: 99, retention_score: 99, review_urgency_score: 99, raw_evidence: "secret",
  });
  assert.deepEqual(Object.keys(dto).sort(), [
    "effectiveMasteryState", "flashcardReviews", "lastEvaluatedAt", "lectureId",
    "masteryState", "nextReviewAt", "objectiveAccuracyPercent", "objectiveAttempts",
    "reviewState", "subjectId",
  ].sort());
  assert.equal(dto.objectiveAccuracyPercent, 50);
});

test("query contract enforces exact filters and bounded pagination", () => {
  assert.equal(validateMasteryQuery({}, false), null);
  assert.match(validateMasteryQuery({ limit: "101" }, false)!, /limit/);
  assert.match(validateMasteryQuery({ limit: "0" }, false)!, /limit/);
  assert.match(validateMasteryQuery({ state: "DUE" }, false)!, /state/);
  assert.equal(validateMasteryQuery({ reviewState: "FRESH" }, false), null);
  assert.match(validateMasteryQuery({ reviewState: "INVALID" }, false)!, /review/);
  assert.match(validateMasteryQuery({ reviewState: "FRESH" }, true)!, /review/);
  assert.match(validateMasteryQuery({ cursor: "x".repeat(201) }, false)!, /cursor/);
  assert.match(validateMasteryQuery({ state: "MASTERED" }, true)!, /state/);
});