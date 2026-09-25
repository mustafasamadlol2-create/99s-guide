import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import test, { after, before } from "node:test";
import {
  StudyPointsError,
  StudyPointsLedgerService,
  StudyPointsLegacyBridgeService,
} from "../server/features/study-points/index.js";
import { STUDY_POINTS_MAX_METADATA_BYTES } from "../server/features/study-points/constants.js";
import type {
  AppendStudyPointsLedgerEntryInput,
} from "../server/features/study-points/types.js";
import { getPrompt19StudyPointsPostgresGateUrl } from "./helpers/prompt19StudyPointsPostgresGate.js";

const databaseUrl = getPrompt19StudyPointsPostgresGateUrl();
const skipped = databaseUrl
  ? false
  : "Set the explicit Prompt 19 disposable-schema test markers to run.";
const EFFECTIVE_AT = new Date("2026-09-25T10:00:00.000Z");

let prisma: PrismaClient | undefined;
let ledger: StudyPointsLedgerService;
let bridge: StudyPointsLegacyBridgeService;

function db(): PrismaClient {
  assert.ok(prisma);
  return prisma;
}

async function createUser(prefix = "ledger"): Promise<{ id: string }> {
  return db().user.create({
    data: { email: `prompt19-${prefix}-${randomUUID()}@example.test` },
    select: { id: true },
  });
}

function request(
  userId: string,
  idempotencyKey: string,
  overrides: Partial<AppendStudyPointsLedgerEntryInput> = {},
): AppendStudyPointsLedgerEntryInput {
  return {
    userId,
    amount: 10,
    category: "FOCUS",
    reasonCode: "focus.verified_duration",
    sourceType: "FOCUS_SESSION",
    sourceId: "session-test",
    ruleVersion: "focus-points-v1",
    idempotencyKey,
    effectiveAt: EFFECTIVE_AT,
    ...overrides,
  };
}

async function assertErrorCode(
  run: () => Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(run, (error: unknown) =>
    error instanceof StudyPointsError && error.code === code);
}

async function sideEffectCounts(userId: string): Promise<number[]> {
  return Promise.all([
    db().studyEvent.count({ where: { userId } }),
    db().studyDailyMetric.count({ where: { userId } }),
    db().calendarEvent.count({ where: { userId } }),
    db().focusSession.count({ where: { userId } }),
    db().lectureProgress.count({ where: { userId } }),
    db().integritySignal.count({ where: { userId } }),
    db().privateD1SyncOutbox.count(),
    db().pointsLog.count({ where: { userId } }),
  ]);
}

if (databaseUrl) {
  before(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    await prisma.$connect();
    ledger = new StudyPointsLedgerService(db());
    bridge = new StudyPointsLegacyBridgeService(db());
  });
  after(async () => {
    await prisma?.$disconnect();
  });
}

test("real Prompt 19 PostgreSQL ledger invariants", { skip: skipped }, async (t) => {
  await t.test("fresh migration history keeps required models and data separate", async () => {
    const tables = await db().$queryRaw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name IN (
          'StudyPointsLedgerEntry',
          'PointsLog',
          'IntegritySignal',
          'GroupFocusRun',
          'FocusQuickNote'
        )
      ORDER BY table_name
    `;
    assert.deepEqual(
      tables.map((table) => table.table_name),
      [
        "FocusQuickNote",
        "GroupFocusRun",
        "IntegritySignal",
        "PointsLog",
        "StudyPointsLedgerEntry",
      ],
    );
    assert.equal(await db().studyPointsLedgerEntry.count(), 0);
    assert.equal(await db().pointsLog.count(), 0);
  });

  await t.test("first append, replay, and PointsLog non-write", async () => {
    const user = await createUser("append");
    try {
      const first = await ledger.appendStudyPointsLedgerEntry(
        request(user.id, "append-once"),
      );
      const replay = await ledger.appendStudyPointsLedgerEntry(
        request(user.id, "append-once"),
      );
      assert.equal(first.replayed, false);
      assert.equal(replay.replayed, true);
      assert.equal(replay.entry.id, first.entry.id);
      assert.equal(
        await db().studyPointsLedgerEntry.count({ where: { userId: user.id } }),
        1,
      );
      assert.equal(await db().pointsLog.count({ where: { userId: user.id } }), 0);
    } finally {
      await db().user.delete({ where: { id: user.id } });
    }
  });

  await t.test("metadata respects the serialized PostgreSQL size boundary", async () => {
    const user = await createUser("metadata-size");
    try {
      const exactCompactLimit = STUDY_POINTS_MAX_METADATA_BYTES - 16;
      await assertErrorCode(
        () => ledger.appendStudyPointsLedgerEntry(request(
          user.id,
          "metadata-too-large",
          { metadata: { technical: "x".repeat(exactCompactLimit) } },
        )),
        "POINTS_INVALID_METADATA",
      );
      const withinStorageLimit = await ledger.appendStudyPointsLedgerEntry(request(
        user.id,
        "metadata-at-storage-limit",
        {
          metadata: {
            technical: "x".repeat(exactCompactLimit - 1),
          },
        },
      ));
      assert.equal(withinStorageLimit.replayed, false);
    } finally {
      await db().user.delete({ where: { id: user.id } });
    }
  });

  await t.test("20 simultaneous identical appends create one row", async () => {
    const user = await createUser("concurrent");
    try {
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          ledger.appendStudyPointsLedgerEntry(
            request(user.id, "concurrent-identical"),
          ),
        ),
      );
      assert.equal(
        await db().studyPointsLedgerEntry.count({ where: { userId: user.id } }),
        1,
      );
      assert.equal(new Set(results.map((result) => result.entry.id)).size, 1);
      assert.equal(results.filter((result) => !result.replayed).length, 1);
      assert.equal(results.filter((result) => result.replayed).length, 19);
    } finally {
      await db().user.delete({ where: { id: user.id } });
    }
  });

  await t.test("concurrent changed payloads conflict on the shared key", async () => {
    const user = await createUser("conflict");
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, (_, index) =>
          ledger.appendStudyPointsLedgerEntry(
            request(user.id, "concurrent-conflict", {
              amount: index % 2 === 0 ? 11 : 12,
            }),
          ),
        ),
      );
      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<Awaited<ReturnType<
          StudyPointsLedgerService["appendStudyPointsLedgerEntry"]
        >>> => result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      assert.equal(fulfilled.length, 10);
      assert.equal(rejected.length, 10);
      assert.ok(rejected.every((result) =>
        result.reason instanceof StudyPointsError
        && result.reason.code === "POINTS_IDEMPOTENCY_CONFLICT"));
      assert.equal(
        await db().studyPointsLedgerEntry.count({ where: { userId: user.id } }),
        1,
      );
    } finally {
      await db().user.delete({ where: { id: user.id } });
    }
  });

  await t.test("database totals, category totals, reversal, replay, and cursor order", async () => {
    const user = await createUser("balance");
    try {
      const focus = await ledger.appendStudyPointsLedgerEntry(
        request(user.id, "balance-focus", { amount: 10 }),
      );
      const mastery = await ledger.appendStudyPointsLedgerEntry(
        request(user.id, "balance-mastery", {
          amount: 20,
          category: "MASTERY",
          reasonCode: "mcq.verified_set",
          sourceType: "MCQ_ATTEMPT",
        }),
      );
      const consistency = await ledger.appendStudyPointsLedgerEntry(
        request(user.id, "balance-consistency", {
          amount: 5,
          category: "CONSISTENCY",
          reasonCode: "consistency.daily",
          sourceType: "DAILY_CONSISTENCY",
        }),
      );

      assert.equal(await ledger.getStudyPointsBalance(user.id), 35);
      assert.deepEqual(await ledger.getStudyPointsBalancesByCategory(user.id), {
        FOCUS: 10,
        MASTERY: 20,
        PROGRESS: 0,
        CONSISTENCY: 5,
        total: 35,
      });

      const reversalInput = {
        userId: user.id,
        entryId: mastery.entry.id,
        reasonCode: "admin.correction",
        ruleVersion: "admin-adjustment-v1",
        idempotencyKey: "reverse-mastery",
        effectiveAt: EFFECTIVE_AT,
      };
      const reversal = await ledger.reverseStudyPointsLedgerEntry(reversalInput);
      const replay = await ledger.reverseStudyPointsLedgerEntry(reversalInput);
      assert.equal(reversal.entry.amount, -20);
      assert.equal(reversal.entry.category, "MASTERY");
      assert.equal(reversal.entry.sourceType, "REVERSAL");
      assert.equal(reversal.entry.sourceId, mastery.entry.id);
      assert.equal(reversal.entry.reversalOfEntryId, mastery.entry.id);
      assert.equal(replay.replayed, true);
      assert.equal(replay.entry.id, reversal.entry.id);
      assert.deepEqual(
        await db().studyPointsLedgerEntry.findUnique({
          where: { id: mastery.entry.id },
        }),
        mastery.entry,
      );
      assert.equal(await ledger.getStudyPointsBalance(user.id), 15);
      assert.deepEqual(await ledger.getStudyPointsBalancesByCategory(user.id), {
        FOCUS: 10,
        MASTERY: 0,
        PROGRESS: 0,
        CONSISTENCY: 5,
        total: 15,
      });
      await assertErrorCode(
        () => ledger.reverseStudyPointsLedgerEntry({
          ...reversalInput,
          idempotencyKey: "reverse-mastery-again",
        }),
        "POINTS_ALREADY_REVERSED",
      );

      const ids = [
        focus.entry.id,
        mastery.entry.id,
        consistency.entry.id,
        reversal.entry.id,
      ].sort().reverse();
      const firstPage = await ledger.listStudyPointsLedgerEntries({
        userId: user.id,
        limit: 2,
      });
      assert.equal(firstPage.entries.length, 2);
      assert.ok(firstPage.nextCursor);
      const secondPage = await ledger.listStudyPointsLedgerEntries({
        userId: user.id,
        cursor: firstPage.nextCursor,
        limit: 2,
      });
      assert.deepEqual(
        [...firstPage.entries, ...secondPage.entries].map((entry) => entry.id),
        ids,
      );
      assert.ok(firstPage.entries.every((entry) => !("metadata" in entry)));
      assert.ok(firstPage.entries.every((entry) => !("idempotencyKey" in entry)));
    } finally {
      await db().user.delete({ where: { id: user.id } });
    }
  });

  await t.test("wrong-user reversal is not found", async () => {
    const [owner, other] = await Promise.all([
      createUser("reverse-owner"),
      createUser("reverse-other"),
    ]);
    try {
      const entry = await ledger.appendStudyPointsLedgerEntry(
        request(owner.id, "wrong-user-target"),
      );
      await assertErrorCode(
        () => ledger.reverseStudyPointsLedgerEntry({
          userId: other.id,
          entryId: entry.entry.id,
          reasonCode: "admin.correction",
          ruleVersion: "admin-adjustment-v1",
          idempotencyKey: "wrong-user-reversal",
          effectiveAt: EFFECTIVE_AT,
        }),
        "POINTS_ENTRY_NOT_FOUND",
      );
    } finally {
      await db().user.deleteMany({
        where: { id: { in: [owner.id, other.id] } },
      });
    }
  });

  await t.test("legacy-only, ledger-only, mixed, and negative composites", async () => {
    const legacyOnly = await createUser("legacy-only");
    const ledgerOnly = await createUser("ledger-only");
    const mixed = await createUser("mixed");
    try {
      await db().pointsLog.create({
        data: {
          userId: legacyOnly.id,
          points: 100,
          reason: "Legacy award",
          id: `legacy-${randomUUID()}`,
        },
      });
      assert.equal(
        await db().studyPointsLedgerEntry.count({ where: { userId: legacyOnly.id } }),
        0,
      );
      assert.deepEqual(
        await bridge.getCompatibleStudyPointsBalance(legacyOnly.id),
        {
          legacyPoints: 100,
          ledgerPoints: 0,
          totalPoints: 100,
          compatibilityMode: "LEGACY_PLUS_LEDGER",
        },
      );

      await ledger.appendStudyPointsLedgerEntry(
        request(ledgerOnly.id, "ledger-only-positive", { amount: 15 }),
      );
      assert.deepEqual(
        await bridge.getCompatibleStudyPointsBalance(ledgerOnly.id),
        {
          legacyPoints: 0,
          ledgerPoints: 15,
          totalPoints: 15,
          compatibilityMode: "LEGACY_PLUS_LEDGER",
        },
      );

      await db().pointsLog.create({
        data: {
          userId: mixed.id,
          points: 100,
          reason: "Legacy award",
          id: `legacy-${randomUUID()}`,
        },
      });
      await ledger.appendStudyPointsLedgerEntry(
        request(mixed.id, "mixed-positive", { amount: 15 }),
      );
      assert.deepEqual(await bridge.getCompatibleStudyPointsBalance(mixed.id), {
        legacyPoints: 100,
        ledgerPoints: 15,
        totalPoints: 115,
        compatibilityMode: "LEGACY_PLUS_LEDGER",
      });
      await ledger.appendStudyPointsLedgerEntry(
        request(mixed.id, "mixed-correction", {
          amount: -10,
          category: "PROGRESS",
          reasonCode: "admin.correction",
          sourceType: "ADMIN_ADJUSTMENT",
        }),
      );
      assert.deepEqual(await bridge.getCompatibleStudyPointsBalance(mixed.id), {
        legacyPoints: 100,
        ledgerPoints: 5,
        totalPoints: 105,
        compatibilityMode: "LEGACY_PLUS_LEDGER",
      });
    } finally {
      await db().user.deleteMany({
        where: { id: { in: [legacyOnly.id, ledgerOnly.id, mixed.id] } },
      });
    }
  });

  await t.test("ledger writes have zero legacy and adjacent-domain side effects", async () => {
    const user = await createUser("side-effects");
    try {
      const before = await sideEffectCounts(user.id);
      const original = await ledger.appendStudyPointsLedgerEntry(
        request(user.id, "side-effect-entry"),
      );
      await ledger.reverseStudyPointsLedgerEntry({
        userId: user.id,
        entryId: original.entry.id,
        reasonCode: "admin.correction",
        ruleVersion: "admin-adjustment-v1",
        idempotencyKey: "side-effect-reversal",
        effectiveAt: EFFECTIVE_AT,
      });
      assert.deepEqual(await sideEffectCounts(user.id), before);
      assert.equal(
        await db().studyPointsLedgerEntry.count({ where: { userId: user.id } }),
        2,
      );
    } finally {
      await db().user.delete({ where: { id: user.id } });
    }
  });

  await t.test("failed reversal transaction leaves no partial row", async () => {
    const user = await createUser("rollback");
    const functionName = "prompt19_force_reversal_failure";
    const triggerName = "prompt19_force_reversal_failure_trigger";
    try {
      const original = await ledger.appendStudyPointsLedgerEntry(
        request(user.id, "rollback-target"),
      );
      await db().$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION "${functionName}"()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW."reasonCode" = 'test.rollback' THEN
            RAISE EXCEPTION 'Prompt 19 forced rollback test';
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await db().$executeRawUnsafe(`
        CREATE TRIGGER "${triggerName}"
        BEFORE INSERT ON "StudyPointsLedgerEntry"
        FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
      `);

      await assert.rejects(() => ledger.reverseStudyPointsLedgerEntry({
        userId: user.id,
        entryId: original.entry.id,
        reasonCode: "test.rollback",
        ruleVersion: "admin-adjustment-v1",
        idempotencyKey: "rollback-reversal",
        effectiveAt: EFFECTIVE_AT,
      }));
      assert.equal(
        await db().studyPointsLedgerEntry.count({ where: { userId: user.id } }),
        1,
      );
      assert.equal(
        await db().studyPointsLedgerEntry.count({
          where: { userId: user.id, sourceType: "REVERSAL" },
        }),
        0,
      );
    } finally {
      await db().$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS "${triggerName}" ON "StudyPointsLedgerEntry"`,
      );
      await db().$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS "${functionName}"()`,
      );
      await db().user.delete({ where: { id: user.id } });
    }
  });
});