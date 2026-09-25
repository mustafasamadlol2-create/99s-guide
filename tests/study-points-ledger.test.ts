import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LEGACY_POINTS_CATEGORY,
  LEGACY_POINTS_RULE_VERSION,
  STUDY_POINTS_CATEGORIES,
  STUDY_POINTS_LEDGER_VERSION,
  STUDY_POINTS_MAX_ENTRY_AMOUNT,
  STUDY_POINTS_MAX_METADATA_BYTES,
  STUDY_POINTS_RULE_DESCRIPTORS,
  StudyPointsError,
  StudyPointsLedgerService,
  normalizeLegacyPointsLog,
  normalizeStudyPointsMetadata,
} from "../server/features/study-points/index.js";
import { safeStudyPointsAggregate } from "../server/features/study-points/aggregate.js";
import {
  decodeStudyPointsHistoryCursor,
  encodeStudyPointsHistoryCursor,
} from "../server/features/study-points/cursor.js";
import { studyPointsSemanticPayload } from "../server/features/study-points/fingerprint.js";
import { normalizeStudyPointsLedgerInput } from "../server/features/study-points/validation.js";
import type { AppendStudyPointsLedgerEntryInput } from "../server/features/study-points/types.js";

const BASE_INPUT: AppendStudyPointsLedgerEntryInput = {
  userId: "user-test",
  amount: 10,
  category: "FOCUS",
  reasonCode: "focus.verified_duration",
  sourceType: "FOCUS_SESSION",
  sourceId: "session-test",
  ruleVersion: "focus-points-v1",
  idempotencyKey: "focus-session:session-test",
  effectiveAt: new Date("2026-09-25T10:00:00.000Z"),
};

function assertStudyPointsCode(
  run: () => unknown,
  expectedCode: string,
): void {
  assert.throws(run, (error: unknown) =>
    error instanceof StudyPointsError && error.code === expectedCode);
}

test("Prompt 19 freezes canonical categories and structural limits", () => {
  assert.deepEqual(STUDY_POINTS_CATEGORIES, [
    "FOCUS",
    "MASTERY",
    "PROGRESS",
    "CONSISTENCY",
  ]);
  assert.equal(STUDY_POINTS_LEDGER_VERSION, 1);
  assert.equal(STUDY_POINTS_MAX_ENTRY_AMOUNT, 100_000);
  assert.equal(STUDY_POINTS_MAX_METADATA_BYTES, 8 * 1024);
  assert.deepEqual(STUDY_POINTS_RULE_DESCRIPTORS, [
    { ruleVersion: "points-ledger-v1", status: "DRAFT" },
  ]);
});

test("ledger input rejects zero, fractional, oversized and invalid values", () => {
  for (const amount of [0, 1.5, 100_001, Number.MAX_SAFE_INTEGER]) {
    assertStudyPointsCode(
      () => normalizeStudyPointsLedgerInput({ ...BASE_INPUT, amount }),
      "POINTS_INVALID_AMOUNT",
    );
  }
  assertStudyPointsCode(
    () => normalizeStudyPointsLedgerInput({
      ...BASE_INPUT,
      category: "SOCIAL" as AppendStudyPointsLedgerEntryInput["category"],
    }),
    "POINTS_INVALID_CATEGORY",
  );
  assertStudyPointsCode(
    () => normalizeStudyPointsLedgerInput({
      ...BASE_INPUT,
      reasonCode: "Human-readable award",
    }),
    "POINTS_INVALID_REASON_CODE",
  );
  assertStudyPointsCode(
    () => normalizeStudyPointsLedgerInput({
      ...BASE_INPUT,
      sourceType: "REVERSAL",
    }),
    "POINTS_INVALID_SOURCE",
  );
});

test("metadata is canonical, bounded, object-only, and rejects private content fields", () => {
  assert.deepEqual(
    normalizeStudyPointsMetadata({ z: 1, a: "value" }),
    { a: "value", z: 1 },
  );
  assert.equal(
    studyPointsSemanticPayload({
      ...BASE_INPUT,
      metadata: { z: 1, a: "value" },
    }),
    studyPointsSemanticPayload({
      ...BASE_INPUT,
      metadata: { a: "value", z: 1 },
    }),
  );
  assertStudyPointsCode(
    () => normalizeStudyPointsMetadata({ technical: "x".repeat(8_200) }),
    "POINTS_INVALID_METADATA",
  );
  assertStudyPointsCode(
    () => normalizeStudyPointsMetadata({ authToken: "must-not-be-stored" }),
    "POINTS_INVALID_METADATA",
  );
});

test("legacy adapter preserves historical identity without inventing a ledger ID", () => {
  const normalized = normalizeLegacyPointsLog({
    id: "legacy-log-1",
    userId: "user-test",
    points: 10,
    reason: "Welcome Award",
    createdAt: new Date("2026-09-25T10:00:00.000Z"),
  });
  assert.equal(normalized.recordKind, "LEGACY");
  assert.equal(normalized.legacyId, "legacy-log-1");
  assert.equal(Object.hasOwn(normalized, "id"), false);
  assert.equal(normalized.category, LEGACY_POINTS_CATEGORY);
  assert.equal(normalized.category, "LEGACY");
  assert.equal(normalized.sourceType, "LEGACY_POINTS_LOG");
  assert.equal(normalized.reasonCode, "legacy.points_log");
  assert.equal(normalized.ruleVersion, LEGACY_POINTS_RULE_VERSION);
});

test("aggregate conversion is safe for integer, BigInt and string results", () => {
  assert.equal(safeStudyPointsAggregate(25), 25);
  assert.equal(safeStudyPointsAggregate(25n), 25);
  assert.equal(safeStudyPointsAggregate("-25"), -25);
  assert.equal(safeStudyPointsAggregate(null), 0);
  assertStudyPointsCode(
    () => safeStudyPointsAggregate(BigInt(Number.MAX_SAFE_INTEGER) + 1n),
    "POINTS_BALANCE_OVERFLOW",
  );
  assertStudyPointsCode(
    () => safeStudyPointsAggregate(1.25),
    "POINTS_BALANCE_OVERFLOW",
  );
});

test("history cursor is stable and rejects malformed input", () => {
  const expected = {
    effectiveAt: new Date("2026-09-25T10:00:00.000Z"),
    id: "entry-1",
  };
  const cursor = encodeStudyPointsHistoryCursor(expected);
  assert.deepEqual(decodeStudyPointsHistoryCursor(cursor), expected);
  assert.equal(decodeStudyPointsHistoryCursor(undefined), null);
  assertStudyPointsCode(
    () => decodeStudyPointsHistoryCursor("not-a-valid-cursor"),
    "POINTS_INVALID_CURSOR",
  );
});

test("the service exposes no semantic ledger update or delete operation", () => {
  const methods = Object.getOwnPropertyNames(StudyPointsLedgerService.prototype);
  assert.ok(methods.includes("appendStudyPointsLedgerEntry"));
  assert.ok(methods.includes("reverseStudyPointsLedgerEntry"));
  assert.ok(methods.includes("getStudyPointsBalance"));
  assert.ok(methods.includes("getStudyPointsBalancesByCategory"));
  assert.ok(methods.includes("listStudyPointsLedgerEntries"));
  assert.ok(!methods.some((method) => /^(?:update|delete)/iu.test(method)));
});

test("ledger schema migration is additive and does not backfill or alter PointsLog", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync(
    "prisma/migrations/20260925110000_study_points_ledger/migration.sql",
    "utf8",
  );
  assert.match(schema, /model StudyPointsLedgerEntry\s*\{/u);
  assert.match(schema, /amount\s+Int/u);
  assert.match(schema, /@@unique\(\[userId, idempotencyKey\]\)/u);
  assert.match(schema, /reversalOfEntryId\s+String\?\s+@unique/u);
  assert.match(schema, /model PointsLog\s*\{[\s\S]*?points\s+Int[\s\S]*?reason\s+String/u);
  assert.doesNotMatch(
    migration,
    /\b(?:DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM)\b/iu,
  );
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+"StudyPointsLedgerEntry"/iu);
  assert.doesNotMatch(migration, /PointsLog/u);
});