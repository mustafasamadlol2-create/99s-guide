import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import test, { after, before } from "node:test";
import { reconcileLeaderboardSnapshot } from "../server/features/leaderboard/reconciliation.js";
import { decodeLeaderboardCursor } from "../server/features/leaderboard/cursor.js";
import { getLeaderboardPage } from "../server/features/leaderboard/queries.js";
import {
  ensureLeaderboardSeason,
} from "../server/features/leaderboard/seasons.js";
import { getLeaderboardSeasonWindow } from "../server/features/leaderboard/periods.js";
import {
  buildLeaderboardSnapshot,
  finalizeLeaderboardSeason,
} from "../server/features/leaderboard/snapshots.js";
import { StudyPointsLedgerService } from "../server/features/study-points/index.js";
import { getPrompt26LeaderboardPostgresGateUrl } from "./helpers/prompt26LeaderboardPostgresGate.js";

const databaseUrl = getPrompt26LeaderboardPostgresGateUrl();
const skipped = databaseUrl
  ? false
  : "Set the explicit Prompt 26 disposable-schema test markers to run.";

let prisma: PrismaClient | undefined;
let ledger: StudyPointsLedgerService;

function db(): PrismaClient {
  assert.ok(prisma);
  return prisma;
}

async function deleteSeasonSnapshots(seasonId: string): Promise<void> {
  const snapshots = await db().leaderboardSnapshot.findMany({
    where: { seasonId },
    select: { id: true, revision: true },
    orderBy: { revision: "desc" },
  });
  for (const snapshot of snapshots) {
    await db().leaderboardSnapshot.delete({ where: { id: snapshot.id } });
  }
}

if (databaseUrl) {
  before(async () => {
    process.env.STUDY_POINTS_ENABLED = "true";
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    ledger = new StudyPointsLedgerService(db());
  });
  after(async () => {
    await prisma?.$disconnect();
  });
}

test("Prompt 26 PostgreSQL schema has additive migration history and starts empty", { skip: skipped }, async () => {
  const tables = await db().$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
  `;
  const tableNames = new Set(tables.map(({ table_name }) => table_name));
  for (const table of [
    "LeaderboardSeason",
    "LeaderboardSnapshot",
    "LeaderboardSnapshotEntry",
    "ChallengeInstance",
    "UserChallengeProgress",
    "UserGamificationLevel",
    "UserAchievement",
    "StudyPointsLedgerEntry",
    "StudyPointsBalanceProjection",
    "PointsLog",
    "IntegritySignal",
  ]) {
    assert.ok(tableNames.has(table), `Expected migrated table ${table}.`);
  }

  const migration = await db().$queryRaw<Array<{ migration_name: string }>>`
    SELECT migration_name
    FROM "_prisma_migrations"
    WHERE migration_name = '20260926120000_leaderboard_canonical'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  `;
  assert.equal(migration.length, 1, "The additive leaderboard migration must be applied to this disposable schema.");

  const [counts] = await db().$queryRaw<Array<{
    seasons: bigint;
    snapshots: bigint;
    entries: bigint;
  }>>`
    SELECT
      (SELECT COUNT(*) FROM "LeaderboardSeason")::bigint AS seasons,
      (SELECT COUNT(*) FROM "LeaderboardSnapshot")::bigint AS snapshots,
      (SELECT COUNT(*) FROM "LeaderboardSnapshotEntry")::bigint AS entries
  `;
  assert.deepEqual(counts, { seasons: 0n, snapshots: 0n, entries: 0n });
});

async function createUser(createdAt?: Date): Promise<{ id: string }> {
  return db().user.create({
    data: {
      email: `prompt26-leaderboard-${randomUUID()}@example.test`,
      ...(createdAt ? { createdAt } : {}),
    },
    select: { id: true },
  });
}

async function appendPoints(input: {
  userId: string;
  amount: number;
  effectiveAt: Date;
}): Promise<void> {
  await ledger.appendStudyPointsLedgerEntry({
    userId: input.userId,
    amount: input.amount,
    category: "FOCUS",
    reasonCode: "focus.verified_duration",
    sourceType: "FOCUS_SESSION",
    sourceId: `prompt26-${randomUUID()}`,
    ruleVersion: "focus-points-v1",
    idempotencyKey: `prompt26-${randomUUID()}`,
    effectiveAt: input.effectiveAt,
  });
}

function historicalSeasonReference(): {
  now: Date;
  effectiveAt: Date;
  window: { startsAt: Date; endsAt: Date };
} {
  const anchor = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const window = getCurrentWeeklyWindow(anchor);
  const now = new Date(window.startsAt.getTime() + 3 * 24 * 60 * 60 * 1000);
  return {
    now,
    effectiveAt: new Date(now.getTime() - 60_000),
    window,
  };
}

function getCurrentWeeklyWindow(now: Date): { startsAt: Date; endsAt: Date } {
  const window = getLeaderboardSeasonWindow("WEEKLY", now);
  assert.ok(window.startsAt);
  assert.ok(window.endsAt);
  return { startsAt: window.startsAt, endsAt: window.endsAt };
}

test("concurrent season ensure and LIVE snapshot builds converge without accounting writes", { skip: skipped }, async () => {
  const reference = historicalSeasonReference();
  let seasonId: string | undefined;
  let userId: string | undefined;
  try {
    const seasons = await Promise.all(Array.from({ length: 20 }, () =>
      ensureLeaderboardSeason({
        scope: "WEEKLY",
        asOf: reference.now,
      }, db())));
    assert.equal(new Set(seasons.map((season) => season.id)).size, 1);
    seasonId = seasons[0]!.id;

    const user = await createUser(new Date(reference.now.getTime() - 1_000));
    userId = user.id;
    await appendPoints({
      userId,
      amount: 20,
      effectiveAt: reference.effectiveAt,
    });

    const ledgerCount = await db().studyPointsLedgerEntry.count({ where: { userId } });
    const legacyCount = await db().pointsLog.count({ where: { userId } });
    const projectionBefore = await db().studyPointsBalanceProjection.findUnique({
      where: { userId },
    });
    const outcomes = await Promise.all(Array.from({ length: 20 }, () =>
      buildLeaderboardSnapshot({
        seasonId: seasonId!,
        snapshotType: "LIVE",
        now: reference.now,
      }, db())));
    const snapshotIds = outcomes.map((outcome) => outcome.snapshot?.id);
    assert.ok(snapshotIds.every((id): id is string => Boolean(id)));
    assert.equal(new Set(snapshotIds).size, 1);
    assert.equal(await db().leaderboardSnapshot.count({
      where: { seasonId, snapshotType: "LIVE", status: "READY" },
    }), 1);
    assert.equal(await db().studyPointsLedgerEntry.count({ where: { userId } }), ledgerCount);
    assert.equal(await db().pointsLog.count({ where: { userId } }), legacyCount);
    assert.deepEqual(
      await db().studyPointsBalanceProjection.findUnique({ where: { userId } }),
      projectionBefore,
    );
  } finally {
    if (seasonId) {
      await deleteSeasonSnapshots(seasonId);
      await db().leaderboardSeason.deleteMany({ where: { id: seasonId } });
    }
    if (userId) await db().user.deleteMany({ where: { id: userId } });
  }
});

test("leaderboard pages return only safe public names and preserve pagination", { skip: skipped }, async () => {
  const reference = historicalSeasonReference();
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "prompt26-leaderboard-test-only-session-secret";
  let seasonId: string | undefined;
  let firstUserId: string | undefined;
  let secondUserId: string | undefined;
  try {
    const season = await ensureLeaderboardSeason({
      scope: "WEEKLY",
      asOf: reference.now,
    }, db());
    seasonId = season.id;
    const eligibleCreatedAt = new Date(reference.now.getTime() - 1_000);
    const firstUser = await createUser(eligibleCreatedAt);
    const secondUser = await createUser(eligibleCreatedAt);
    firstUserId = firstUser.id;
    secondUserId = secondUser.id;
    await db().user.update({
      where: { id: firstUser.id },
      data: { name: "Maya Noor" },
    });
    await db().user.update({
      where: { id: secondUser.id },
      data: { name: `private-${randomUUID()}@example.test` },
    });
    await appendPoints({
      userId: firstUser.id,
      amount: 30,
      effectiveAt: reference.effectiveAt,
    });
    await appendPoints({
      userId: secondUser.id,
      amount: 20,
      effectiveAt: reference.effectiveAt,
    });
    await buildLeaderboardSnapshot({
      seasonId: season.id,
      snapshotType: "LIVE",
      now: reference.now,
    }, db());

    const firstPage = await getLeaderboardPage({
      viewerId: firstUser.id,
      scope: "WEEKLY",
      seasonKey: season.seasonKey,
      limit: 1,
      now: reference.now,
      database: db(),
    });
    assert.equal(firstPage.entries.length, 1);
    assert.equal(firstPage.entries[0]?.displayName, "Maya Noor");
    assert.ok(firstPage.nextCursor);
    const cursor = decodeLeaderboardCursor(firstPage.nextCursor, reference.now.getTime());
    const secondPage = await getLeaderboardPage({
      viewerId: firstUser.id,
      scope: "WEEKLY",
      seasonKey: season.seasonKey,
      limit: 1,
      cursor,
      now: reference.now,
      database: db(),
    });
    assert.equal(secondPage.entries.length, 1);
    assert.equal(secondPage.entries[0]?.displayName, null);
    const publicPages = JSON.stringify([firstPage.entries, secondPage.entries]);
    assert.equal(publicPages.includes(firstUser.id), false);
    assert.equal(publicPages.includes(secondUser.id), false);
    assert.equal(publicPages.includes("@example.test"), false);
  } finally {
    if (seasonId) {
      await deleteSeasonSnapshots(seasonId);
      await db().leaderboardSeason.deleteMany({ where: { id: seasonId } });
    }
    if (firstUserId) await db().user.deleteMany({ where: { id: firstUserId } });
    if (secondUserId) await db().user.deleteMany({ where: { id: secondUserId } });
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("concurrent finalization is idempotent and late correction creates an auditable revision", { skip: skipped }, async () => {
  const reference = historicalSeasonReference();
  const now = reference.now;
  const window = reference.window;
  const effectiveAt = reference.effectiveAt;
  let seasonId: string | undefined;
  let userId: string | undefined;
  try {
    const season = await ensureLeaderboardSeason({
      scope: "WEEKLY",
      asOf: now,
    }, db());
    seasonId = season.id;
    const user = await createUser(new Date(reference.now.getTime() - 1_000));
    userId = user.id;
    await appendPoints({ userId, amount: 20, effectiveAt });

    const finalizeAt = new Date(window.endsAt.getTime() + 1);
    const finals = await Promise.all(Array.from({ length: 20 }, () =>
      finalizeLeaderboardSeason({
        seasonId: season.id,
        now: finalizeAt,
      }, db())));
    const finalSnapshotIds = new Set(finals.map((result) => result.snapshot.id));
    assert.equal(finalSnapshotIds.size, 1);
    const firstFinal = finals[0]!.snapshot;
    assert.equal(firstFinal.revision, 1);
    assert.equal(await db().leaderboardSnapshot.count({
      where: { seasonId: season.id, snapshotType: "FINAL", status: "READY" },
    }), 1);
    assert.equal(
      (await db().leaderboardSeason.findUniqueOrThrow({ where: { id: season.id } })).status,
      "CLOSED",
    );

    const accountingBeforeCorrection = {
      ledger: await db().studyPointsLedgerEntry.count({ where: { userId } }),
      pointsLog: await db().pointsLog.count({ where: { userId } }),
      projection: await db().studyPointsBalanceProjection.findUnique({ where: { userId } }),
    };
    const lateEffectiveAt = new Date(Math.min(
      window.endsAt.getTime() - 1,
      Math.max(window.startsAt.getTime(), now.getTime() - 30_000),
    ));
    await appendPoints({ userId, amount: 5, effectiveAt: lateEffectiveAt });
    const projectionAfterLateEntry =
      await db().studyPointsBalanceProjection.findUnique({ where: { userId } });
    const drift = await reconcileLeaderboardSnapshot({
      seasonId: season.id,
      now: finalizeAt,
    }, db());
    assert.ok(drift.anomalies.includes("SOURCE_FINGERPRINT_MISMATCH"));
    assert.ok(drift.anomalies.includes("SCORE_MISMATCH"));

    const repaired = await reconcileLeaderboardSnapshot({
      seasonId: season.id,
      repair: true,
      now: finalizeAt,
    }, db());
    assert.equal(repaired.repaired, true);
    assert.deepEqual(repaired.anomalies, []);
    assert.notEqual(repaired.replacementSnapshotId, firstFinal.id);
    const revisions = await db().leaderboardSnapshot.findMany({
      where: { seasonId: season.id, snapshotType: "FINAL", status: "READY" },
      orderBy: { revision: "asc" },
    });
    assert.equal(revisions.length, 2);
    assert.equal(revisions[0]!.id, firstFinal.id);
    assert.equal(revisions[0]!.sourceFingerprint, firstFinal.sourceFingerprint);
    assert.equal(revisions[1]!.revision, 2);
    assert.equal(revisions[1]!.supersedesSnapshotId, firstFinal.id);
    assert.equal(
      await db().studyPointsLedgerEntry.count({ where: { userId } }),
      accountingBeforeCorrection.ledger + 1,
    );
    assert.equal(
      await db().pointsLog.count({ where: { userId } }),
      accountingBeforeCorrection.pointsLog,
    );
    assert.deepEqual(
      await db().studyPointsBalanceProjection.findUnique({ where: { userId } }),
      projectionAfterLateEntry,
    );
  } finally {
    if (seasonId) {
      await deleteSeasonSnapshots(seasonId);
      await db().leaderboardSeason.deleteMany({ where: { id: seasonId } });
    }
    if (userId) await db().user.deleteMany({ where: { id: userId } });
  }
});