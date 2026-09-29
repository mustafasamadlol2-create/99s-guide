import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import test, { after, before } from "node:test";
import {
  getCanonicalStudyPointsLedgerBalance,
  getStudyPointsCutoverReadiness,
  getStudyPointsReadModel,
  reconcileStudyPointsAccount,
  StudyPointsLedgerService,
  StudyPointsError,
} from "../server/features/study-points/index.js";
import type { AppendStudyPointsLedgerEntryInput } from "../server/features/study-points/types.js";
import { getPrompt21StudyPointsPostgresGateUrl } from "./helpers/prompt21StudyPointsPostgresGate.js";

const databaseUrl = getPrompt21StudyPointsPostgresGateUrl();
const skipped = databaseUrl
  ? false
  : "Set the explicit Prompt 21 disposable-schema PostgreSQL gate to run.";
const NOW = new Date("2026-09-25T10:00:00.000Z");

let prisma: PrismaClient | undefined;
let ledger: StudyPointsLedgerService;

function db(): PrismaClient {
  assert.ok(prisma);
  return prisma;
}

async function createUser(): Promise<string> {
  const user = await db().user.create({
    data: { email: `prompt21-points-${randomUUID()}@example.test` },
    select: { id: true },
  });
  return user.id;
}

function request(
  userId: string,
  idempotencyKey: string,
  overrides: Partial<AppendStudyPointsLedgerEntryInput> = {},
): AppendStudyPointsLedgerEntryInput {
  return {
    userId,
    amount: 1,
    category: "FOCUS",
    reasonCode: "focus.verified_completion",
    sourceType: "FOCUS_SESSION",
    sourceId: idempotencyKey,
    ruleVersion: "focus-completion-v1",
    idempotencyKey,
    effectiveAt: NOW,
    ...overrides,
  };
}

if (databaseUrl) {
  before(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    ledger = new StudyPointsLedgerService(db());
  });
  after(async () => {
    await prisma?.$disconnect();
  });
}

test("concurrent appends, replay, reversal and repair preserve exact projection", {
  skip: skipped,
}, async () => {
  const userId = await createUser();
  try {
    const preexisting = await Promise.all([
      db().studyPointsLedgerEntry.create({
        data: {
          user: { connect: { id: userId } },
          amount: 4,
          category: "FOCUS",
          reasonCode: "focus.verified_completion",
          sourceType: "FOCUS_SESSION",
          sourceId: "preexisting-focus",
          ruleVersion: "focus-completion-v1",
          idempotencyKey: "preexisting-focus",
          effectiveAt: NOW,
        },
      }),
      db().studyPointsLedgerEntry.create({
        data: {
          user: { connect: { id: userId } },
          amount: 3,
          category: "MASTERY",
          reasonCode: "mcq.verified_set",
          sourceType: "MCQ_ATTEMPT",
          sourceId: "preexisting-mastery",
          ruleVersion: "mcq-verified-set-v1",
          idempotencyKey: "preexisting-mastery",
          effectiveAt: NOW,
        },
      }),
    ]);
    const concurrent = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        ledger.appendStudyPointsLedgerEntry(
          request(userId, `distinct-${index}`, {
            amount: index + 1,
            category: index % 2 === 0 ? "FOCUS" : "MASTERY",
          }),
        ),
      ),
    );
    assert.equal(concurrent.length, 20);
    let canonical = await getCanonicalStudyPointsLedgerBalance(userId, db());
    let projection = await db().studyPointsBalanceProjection.findUniqueOrThrow({
      where: { userId },
    });
    assert.equal(canonical.ledgerEntryCount, 22);
    assert.equal(projection.ledgerEntryCount, 22n);
    assert.equal(projection.totalPoints, BigInt(canonical.totalPoints));

    const noOpBefore = { ...projection };
    const noOpRepair = await reconcileStudyPointsAccount(
      { userId, repairProjection: true },
      db(),
    );
    const noOpAfter = await db().studyPointsBalanceProjection.findUniqueOrThrow({
      where: { userId },
    });
    assert.equal(noOpRepair.repaired, false);
    assert.equal(noOpAfter.projectionVersion, noOpBefore.projectionVersion);
    assert.equal(noOpAfter.updatedAt.getTime(), noOpBefore.updatedAt.getTime());
    assert.ok(noOpAfter.lastReconciledAt instanceof Date);

    const replayRequest = request(userId, "distinct-0");
    const beforeReplay = { ...projection };
    const replay = await ledger.appendStudyPointsLedgerEntry(replayRequest);
    assert.equal(replay.replayed, true);
    projection = await db().studyPointsBalanceProjection.findUniqueOrThrow({
      where: { userId },
    });
    assert.equal(projection.ledgerEntryCount, beforeReplay.ledgerEntryCount);
    assert.equal(projection.projectionVersion, beforeReplay.projectionVersion);

    const original = concurrent[0]!.entry;
    await ledger.reverseStudyPointsLedgerEntry({
      userId,
      entryId: original.id,
      reasonCode: "admin.correction",
      ruleVersion: "admin-reversal-v1",
      idempotencyKey: "reverse-distinct-0",
      effectiveAt: NOW,
    });
    canonical = await getCanonicalStudyPointsLedgerBalance(userId, db());
    projection = await db().studyPointsBalanceProjection.findUniqueOrThrow({
      where: { userId },
    });
    assert.equal(projection.ledgerEntryCount, BigInt(canonical.ledgerEntryCount));
    assert.equal(projection.totalPoints, BigInt(canonical.totalPoints));

    await db().studyPointsBalanceProjection.update({
      where: { userId },
      data: { totalPoints: 999n },
    });
    const dryRun = await reconcileStudyPointsAccount({ userId }, db());
    assert.equal(dryRun.status, "PROJECTION_DRIFT");
    const repaired = await reconcileStudyPointsAccount(
      { userId, repairProjection: true },
      db(),
    );
    assert.equal(repaired.repaired, true);
    assert.equal(repaired.projection?.totalPoints, canonical.totalPoints);
    assert.equal(
      await db().studyPointsLedgerEntry.count({ where: { userId } }),
      canonical.ledgerEntryCount,
    );

    await db().studyPointsBalanceProjection.update({
      where: { userId },
      data: { masteryPoints: { increment: 1n } },
    });
    const categoryDrift = await reconcileStudyPointsAccount({ userId }, db());
    assert.equal(categoryDrift.status, "PROJECTION_DRIFT");
    assert.ok(categoryDrift.checks.some((check) =>
      check.code === "PROJECTION_CATEGORY_MISMATCH" && check.status === "FAIL"));
    await reconcileStudyPointsAccount({ userId, repairProjection: true }, db());

    await db().studyPointsBalanceProjection.update({
      where: { userId },
      data: { ledgerEntryCount: { increment: 1n } },
    });
    const countDrift = await reconcileStudyPointsAccount({ userId }, db());
    assert.equal(countDrift.status, "PROJECTION_DRIFT");
    assert.ok(countDrift.checks.some((check) =>
      check.code === "PROJECTION_ENTRY_COUNT_MISMATCH" && check.status === "FAIL"));
    await reconcileStudyPointsAccount({ userId, repairProjection: true }, db());

    await db().studyPointsBalanceProjection.delete({ where: { userId } });
    const fallback = await getStudyPointsReadModel({
      userId,
      compatibilityMode: "LEGACY_PLUS_LEDGER",
    }, db());
    assert.equal(fallback.source, "LEDGER_FALLBACK");
    assert.equal(fallback.ledgerPoints, canonical.totalPoints);
    assert.equal(
      await db().studyPointsBalanceProjection.count({ where: { userId } }),
      0,
    );
    const missingRepair = await reconcileStudyPointsAccount(
      { userId, repairProjection: true },
      db(),
    );
    assert.equal(missingRepair.status, "PROJECTION_MISSING");
    assert.equal(missingRepair.repaired, true);
    assert.equal(
      (await db().studyPointsBalanceProjection.findUniqueOrThrow({ where: { userId } }))
        .totalPoints,
      BigInt(canonical.totalPoints),
    );
    assert.equal(preexisting.length, 2);
  } finally {
    await db().user.delete({ where: { id: userId } });
  }
});

test("compatibility modes preserve legacy totals and gate ledger-only cutover", {
  skip: skipped,
}, async () => {
  const userId = await createUser();
  try {
    await db().pointsLog.create({
      data: { userId, points: 100, reason: "Legacy test award" },
    });
    await ledger.appendStudyPointsLedgerEntry(request(userId, "compat-ledger", {
      amount: 15,
      category: "MASTERY",
      sourceType: "MCQ_ATTEMPT",
      reasonCode: "mcq.verified_set",
      ruleVersion: "mcq-verified-set-v1",
    }));

    const legacyOnly = await getStudyPointsReadModel({
      userId,
      compatibilityMode: "LEGACY_ONLY",
    }, db());
    assert.equal(legacyOnly.legacyPoints, 100);
    assert.equal(legacyOnly.ledgerPoints, 15);
    assert.equal(legacyOnly.totalPoints, 100);

    const transitional = await getStudyPointsReadModel({
      userId,
      compatibilityMode: "LEGACY_PLUS_LEDGER",
    }, db());
    assert.equal(transitional.totalPoints, 115);
    assert.equal(transitional.masteryPoints, 15);
    assert.equal(transitional.focusPoints, 0);

    await assert.rejects(
      getStudyPointsReadModel({ userId, compatibilityMode: "LEDGER_ONLY" }, db()),
      (error: unknown) =>
        error instanceof StudyPointsError
        && error.code === "POINTS_LEDGER_ONLY_NOT_READY",
    );

    await db().pointsLog.deleteMany({ where: { userId } });
    const cutoverSafe = await getStudyPointsCutoverReadiness(userId, db());
    assert.equal(cutoverSafe.safeForLedgerOnly, true);
    const ledgerOnly = await getStudyPointsReadModel({
      userId,
      compatibilityMode: "LEDGER_ONLY",
    }, db());
    assert.equal(ledgerOnly.totalPoints, 15);
    assert.equal(ledgerOnly.legacyPoints, 0);
    assert.equal(ledgerOnly.masteryPoints, 15);
  } finally {
    await db().user.delete({ where: { id: userId } });
  }
});

test("invalid ledger refuses repair and projection failures roll back append and reversal", {
  skip: skipped,
}, async () => {
  const invalidUserId = await createUser();
  const failureUserId = await createUser();
  const triggerName = "prompt21_fail_projection_update";
  const functionName = "prompt21_fail_projection_update_fn";
  try {
    const invalidReversalOriginal = await db().studyPointsLedgerEntry.create({
      data: {
        user: { connect: { id: invalidUserId } },
        amount: 10,
        category: "FOCUS",
        reasonCode: "focus.verified_completion",
        sourceType: "ADMIN_ADJUSTMENT",
        sourceId: "invalid-reversal-original",
        ruleVersion: "test-v1",
        idempotencyKey: "invalid-reversal-original",
        effectiveAt: NOW,
      },
    });
    await db().studyPointsLedgerEntry.create({
      data: {
        user: { connect: { id: invalidUserId } },
        amount: -9,
        category: "FOCUS",
        reasonCode: "admin.invalid_reversal",
        sourceType: "REVERSAL",
        sourceId: invalidReversalOriginal.id,
        ruleVersion: "test-v1",
        idempotencyKey: "invalid-reversal-fixture",
        effectiveAt: NOW,
        reversalOf: { connect: { id: invalidReversalOriginal.id } },
      },
    });
    const invalidDryRun = await reconcileStudyPointsAccount(
      { userId: invalidUserId },
      db(),
    );
    assert.equal(invalidDryRun.status, "LEDGER_INVARIANT_FAILURE");
    const invalidRepair = await reconcileStudyPointsAccount(
      { userId: invalidUserId, repairProjection: true },
      db(),
    );
    assert.equal(invalidRepair.repaired, false);
    assert.equal(
      await db().studyPointsBalanceProjection.count({ where: { userId: invalidUserId } }),
      0,
    );

    const original = await ledger.appendStudyPointsLedgerEntry(
      request(failureUserId, "rollback-original"),
    );
    await db().$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "prompt21_points_gate"."${functionName}"()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Prompt 21 test projection failure';
      END;
      $$
    `);
    await db().$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE UPDATE ON "prompt21_points_gate"."StudyPointsBalanceProjection"
      FOR EACH ROW EXECUTE FUNCTION
      "prompt21_points_gate"."${functionName}"()
    `);

    await assert.rejects(
      ledger.appendStudyPointsLedgerEntry(
        request(failureUserId, "rollback-append", { amount: 2 }),
      ),
    );
    assert.equal(
      await db().studyPointsLedgerEntry.count({
        where: { userId: failureUserId, idempotencyKey: "rollback-append" },
      }),
      0,
    );
    await assert.rejects(ledger.reverseStudyPointsLedgerEntry({
      userId: failureUserId,
      entryId: original.entry.id,
      reasonCode: "admin.correction",
      ruleVersion: "admin-reversal-v1",
      idempotencyKey: "rollback-reversal",
      effectiveAt: NOW,
    }));
    assert.equal(
      await db().studyPointsLedgerEntry.count({
        where: { userId: failureUserId, sourceType: "REVERSAL" },
      }),
      0,
    );
    assert.equal(
      await db().studyPointsLedgerEntry.count({
        where: { id: original.entry.id, userId: failureUserId },
      }),
      1,
    );
  } finally {
    await db().$executeRawUnsafe(`
      DROP TRIGGER IF EXISTS "${triggerName}"
      ON "prompt21_points_gate"."StudyPointsBalanceProjection"
    `);
    await db().$executeRawUnsafe(`
      DROP FUNCTION IF EXISTS "prompt21_points_gate"."${functionName}"()
    `);
    await db().user.deleteMany({
      where: { id: { in: [invalidUserId, failureUserId] } },
    });
  }
});

test("same-key concurrent append applies the projection exactly once", {
  skip: skipped,
}, async () => {
  const userId = await createUser();
  try {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        ledger.appendStudyPointsLedgerEntry(request(userId, "one-source")),
      ),
    );
    assert.equal(results.filter((result) => !result.replayed).length, 1);
    assert.equal(
      await db().studyPointsLedgerEntry.count({ where: { userId } }),
      1,
    );
    const projection = await db().studyPointsBalanceProjection.findUniqueOrThrow({
      where: { userId },
    });
    assert.equal(projection.ledgerEntryCount, 1n);
    assert.equal(projection.totalPoints, 1n);
  } finally {
    await db().user.delete({ where: { id: userId } });
  }
});