import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260924000000_study_engine_batch_a_focus_events/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

const expectedBatchAModels = [
  "FocusPlan",
  "FocusPlanItem",
  "FocusSession",
  "StudyEvent",
  "StudyDailyMetric",
] as const;

const prompt13Models = ["GroupFocusRoom", "GroupFocusMembership"] as const;

const forbiddenFutureModels = [
  "FocusSessionInterruption",
  "FocusResourceHandoff",
  "StudyIntegrityFlag",
  "PointsLedgerEntry",
  "SpacedRecallState",
  "AIStudyInsight",
  "OwnerAnalyticsAggregate",
] as const;

function modelBlock(modelName: string): string {
  const match = schema.match(
    new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`, "u"),
  );
  assert.ok(match, `Expected model ${modelName} in Prisma schema.`);
  return match[0];
}

test("Batch A and Prompt 13 models exist without obsolete deferred aliases", () => {
  const modelNames = [...schema.matchAll(/^model\s+(\w+)\s*\{/gmu)].map(
    (match) => match[1],
  );

  for (const modelName of expectedBatchAModels) {
    assert.equal(modelNames.includes(modelName), true);
  }
  for (const modelName of prompt13Models) {
    assert.equal(modelNames.includes(modelName), true);
  }
  for (const modelName of forbiddenFutureModels) {
    assert.equal(modelNames.includes(modelName), false);
  }
});

test("Focus Plan Items preserve independent Lecture configuration", () => {
  const block = modelBlock("FocusPlanItem");
  for (const field of [
    "lectureId",
    "sequence",
    "sessionCount",
    "focusDurationSeconds",
    "breakDurationSeconds",
    "includeMcq",
    "includeFlashcards",
    "includeVideo",
  ]) {
    assert.match(block, new RegExp(`\\b${field}\\b`, "u"));
  }
  assert.match(block, /@@unique\(\[planId, sequence\]\)/u);
  assert.doesNotMatch(block, /CalendarEvent/u);
});

test("Focus Sessions and Study Events have scoped idempotency", () => {
  assert.match(modelBlock("FocusSession"), /@@unique\(\[userId, idempotencyKey\]\)/u);
  assert.match(modelBlock("StudyEvent"), /@@unique\(\[userId, idempotencyKey\]\)/u);
  assert.match(modelBlock("FocusSession"), /status\s+String\s+@default\("CREATED"\)/u);
});

test("StudyEvent keeps canonical event references history-safe", () => {
  const block = modelBlock("StudyEvent");
  assert.match(block, /eventType\s+String/u);
  assert.match(block, /source\s+String/u);
  assert.match(block, /evidenceClass\s+String/u);
  assert.match(block, /privacyClass\s+String/u);
  assert.match(block, /payload\s+Json/u);
  assert.match(block, /groupFocusRoomId\s+String\?/u);
  assert.match(block, /onDelete: SetNull/u);
  assert.doesNotMatch(block, /CalendarEvent/u);
});

test("StudyDailyMetric is one raw-counter row per logical study day", () => {
  const block = modelBlock("StudyDailyMetric");
  assert.match(block, /metricDate\s+DateTime\s+@db\.Date/u);
  for (const field of [
    "focusSeconds",
    "sessionsCompleted",
    "mcqAttempts",
    "mcqCorrect",
    "flashcardReviews",
    "recallAttempts",
    "recallCorrect",
    "lectureCompletions",
    "interruptionCount",
  ]) {
    assert.match(block, new RegExp(`\\b${field}\\b`, "u"));
  }
  assert.match(block, /@@unique\(\[userId, metricDate\]\)/u);
});

test("Batch A migration is additive and contains no destructive statements", () => {
  assert.equal((migration.match(/CREATE TABLE /gu) ?? []).length, 5);
  assert.equal((migration.match(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/giu) ?? []).length, 0);
  assert.equal((migration.match(/ALTER TABLE /gu) ?? []).length, 14);
  assert.match(migration, /ON DELETE SET NULL/u);
  assert.match(migration, /ON DELETE RESTRICT/u);
  assert.doesNotMatch(migration, /CalendarEvent|PointsLog/u);
});

test("legacy CalendarEvent and PointsLog models remain present", () => {
  assert.match(modelBlock("CalendarEvent"), /model CalendarEvent/u);
  const pointsLog = modelBlock("PointsLog");
  assert.match(pointsLog, /points\s+Int/u);
  assert.match(pointsLog, /reason\s+String/u);
  assert.doesNotMatch(schema, /model PointsLedgerEntry\s*\{/u);
});