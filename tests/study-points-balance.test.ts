import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  auditStudyPointsLedger,
  planStudyPointsAccountingRepair,
  resolveStudyPointsReadMode,
} from "../server/features/study-points/index.js";
import type { StudyPointsAuditEntry } from "../server/features/study-points/accountingAudit.js";

function entry(
  overrides: Partial<StudyPointsAuditEntry> = {},
): StudyPointsAuditEntry {
  return {
    id: "entry-1",
    userId: "user-1",
    amount: 10,
    category: "FOCUS",
    reasonCode: "focus.verified_completion",
    sourceType: "FOCUS_SESSION",
    sourceId: "source-1",
    ruleVersion: "focus-completion-v1",
    effectiveAt: new Date("2026-09-25T10:00:00.000Z"),
    reversalOfEntryId: null,
    ...overrides,
  };
}

test("read mode defaults safely and rejects malformed values to LEGACY_ONLY", () => {
  assert.equal(resolveStudyPointsReadMode(undefined), "LEGACY_ONLY");
  assert.equal(resolveStudyPointsReadMode("nonsense"), "LEGACY_ONLY");
  assert.equal(resolveStudyPointsReadMode("LEDGER_ONLY"), "LEDGER_ONLY");
  assert.equal(resolveStudyPointsReadMode("LEGACY_PLUS_LEDGER"), "LEGACY_PLUS_LEDGER");
});

test("ledger accounting audit accepts a structurally valid award and reversal", () => {
  const original = entry();
  const reversal = entry({
    id: "entry-2",
    amount: -10,
    sourceType: "REVERSAL",
    sourceId: original.id,
    reasonCode: "admin.correction",
    reversalOfEntryId: original.id,
  });
  const result = auditStudyPointsLedger(
    [original, reversal],
    new Map([[original.id, original]]),
  );
  assert.deepEqual(result.blockingCodes, []);
  assert.equal(result.anomalyCodes.includes("INVALID_REVERSAL_RELATION"), false);
});

test("ledger accounting audit reports duplicate source awards, zero rows and bad reversals", () => {
  const first = entry();
  const second = entry({ id: "entry-2" });
  const zero = entry({ id: "entry-3", amount: 0, sourceId: "source-3" });
  const malformed = entry({
    id: "entry-4",
    amount: -1,
    sourceType: "FOCUS_SESSION",
    sourceId: "source-4",
  });
  const emptyReversalTarget = entry({
    id: "entry-5",
    amount: -1,
    sourceType: "FOCUS_SESSION",
    sourceId: "source-5",
    reversalOfEntryId: "",
  });
  const result = auditStudyPointsLedger(
    [first, second, zero, malformed, emptyReversalTarget],
    new Map(),
  );
  assert.ok(result.anomalyCodes.includes("DUPLICATE_SOURCE_AWARD"));
  assert.ok(result.anomalyCodes.includes("ZERO_VALUE_LEDGER_ENTRY"));
  assert.ok(result.anomalyCodes.includes("INVALID_REVERSAL_RELATION"));
  assert.deepEqual(result.blockingCodes, [
    "ZERO_VALUE_LEDGER_ENTRY",
    "INVALID_REVERSAL_RELATION",
  ]);
});

test("daily cap audit groups effective timestamps by Baghdad calendar day", () => {
  const result = auditStudyPointsLedger(
    [
      entry({
        id: "entry-1",
        amount: 40,
        effectiveAt: new Date("2026-09-25T20:30:00.000Z"),
      }),
      entry({
        id: "entry-2",
        amount: 30,
        sourceId: "source-2",
        effectiveAt: new Date("2026-09-25T20:00:00.000Z"),
      }),
    ],
    new Map(),
  );
  assert.ok(result.anomalyCodes.includes("CATEGORY_CAP_EXCEEDED"));
});

test("daily category and total caps audit net ledger entries", () => {
  const result = auditStudyPointsLedger(
    [
      entry({ id: "focus-1", amount: 60, sourceId: "focus-1" }),
      entry({
        id: "focus-reversal",
        amount: -20,
        sourceType: "REVERSAL",
        sourceId: "focus-1",
        reasonCode: "admin.correction",
        reversalOfEntryId: "focus-1",
      }),
      entry({
        id: "mastery-1",
        amount: 40,
        category: "MASTERY",
        sourceType: "MCQ_ATTEMPT",
        sourceId: "mastery-1",
      }),
      entry({
        id: "progress-1",
        amount: 31,
        category: "PROGRESS",
        sourceType: "FLASHCARD_REVIEW",
        sourceId: "progress-1",
      }),
    ],
    new Map([["focus-1", entry({ id: "focus-1", amount: 60, sourceId: "focus-1" })]]),
  );
  assert.ok(result.anomalyCodes.includes("CATEGORY_CAP_EXCEEDED"));
  assert.ok(result.anomalyCodes.includes("TOTAL_DAILY_CAP_EXCEEDED"));
});

test("consistency uniqueness and social bonus caps use Prompt 20 semantics", () => {
  const effectiveAt = new Date("2026-09-25T10:00:00.000Z");
  const consistency = Array.from({ length: 2 }, (_, index) =>
    entry({
      id: `consistency-${index}`,
      amount: 5,
      category: "CONSISTENCY",
      reasonCode: "consistency.verified_study_day",
      sourceType: "DAILY_CONSISTENCY",
      sourceId: `consistency-${index}`,
      ruleVersion: "daily-consistency-v1",
      effectiveAt,
    }),
  );
  const social = Array.from({ length: 4 }, (_, index) =>
    entry({
      id: `social-${index}`,
      amount: 2,
      reasonCode: "group_focus.verified_social_bonus",
      sourceType: "GROUP_FOCUS_RUN",
      sourceId: `social-${index}`,
      ruleVersion: "group-focus-participation-v1",
      effectiveAt,
    }),
  );
  const audit = auditStudyPointsLedger([...consistency, ...social], new Map());
  assert.ok(audit.anomalyCodes.includes("DUPLICATE_DAILY_CONSISTENCY_AWARD"));
  assert.ok(audit.anomalyCodes.includes("SOCIAL_BONUS_DAILY_CAP_EXCEEDED"));
});

test("repair planner recommends only a confirmed duplicate positive source reversal", async () => {
  const candidate = {
    id: "duplicate-2",
    amount: 10,
    category: "FOCUS",
    sourceType: "FOCUS_SESSION",
    sourceId: "focus-1",
    reasonCode: "focus.verified_completion",
    ruleVersion: "focus-completion-v1",
    reversalOfEntryId: null,
  };
  const database = {
    async $transaction<T>(run: (tx: unknown) => Promise<T>) {
      return run({
        studyPointsLedgerEntry: {
          async findFirst() {
            return candidate;
          },
          async count() {
            return 2;
          },
          async findUnique() {
            return null;
          },
        },
      });
    },
  } as unknown as PrismaClient;
  const plan = await planStudyPointsAccountingRepair({
    userId: "user-1",
    anomalyCode: "DUPLICATE_SOURCE_AWARD",
    entryId: candidate.id,
  }, database);
  assert.equal(plan.action, "REVERSE_ENTRY");
  assert.equal(plan.entryId, candidate.id);
  assert.equal(plan.requiresExplicitOperation, true);

  const unsupported = await planStudyPointsAccountingRepair({
    userId: "user-1",
    anomalyCode: "INVALID_REVERSAL_RELATION",
    entryId: candidate.id,
  }, database);
  assert.equal(unsupported.action, "MANUAL_REVIEW_REQUIRED");
});

test("projection migration only adds the rebuildable table and constraints", () => {
  const migration = readFileSync(
    "prisma/migrations/20260925120000_study_points_balance_projection/migration.sql",
    "utf8",
  );
  assert.match(migration, /CREATE TABLE "StudyPointsBalanceProjection"/);
  assert.match(migration, /"focusPoints" BIGINT/);
  assert.match(migration, /"masteryPoints" BIGINT/);
  assert.match(migration, /"progressPoints" BIGINT/);
  assert.match(migration, /"consistencyPoints" BIGINT/);
  assert.match(migration, /"ledgerEntryCount" BIGINT/);
  assert.doesNotMatch(migration, /\b(DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM)\b/i);
  assert.doesNotMatch(migration, /ALTER TABLE "(?:PointsLog|StudyPointsLedgerEntry)"/);
});