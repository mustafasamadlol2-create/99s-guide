import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { getLeaderboardRankingSemanticsVersion } from "../server/features/leaderboard/fingerprint.js";
import { getReadableLeaderboardSnapshot } from "../server/features/leaderboard/snapshots.js";

const now = new Date("2026-11-24T12:00:00.000Z");
const season = {
  id: "phase75-monthly-season",
  scope: "MONTHLY",
  seasonKey: "monthly:2026-11",
  status: "ACTIVE",
  startsAt: new Date("2026-10-31T21:00:00.000Z"),
  endsAt: new Date("2026-11-30T21:00:00.000Z"),
};
const snapshot = {
  id: "phase75-live-snapshot",
  seasonId: season.id,
  status: "READY",
  snapshotType: "LIVE",
  generatedAt: new Date(now.getTime() - 60_000),
  scoreThrough: new Date(now.getTime() - 60_000),
  entryCount: 2,
  rankingSemanticsVersion: getLeaderboardRankingSemanticsVersion("MONTHLY"),
};

function createDatabase({
  entryCount = 2,
  ledgerChanged = false,
  generatedAt = snapshot.generatedAt,
}: { entryCount?: number; ledgerChanged?: boolean; generatedAt?: Date } = {}) {
  let transactionCalls = 0;
  const database = {
    leaderboardSnapshot: {
      findFirst: async () => ({ ...snapshot, generatedAt }),
    },
    user: { count: async () => entryCount },
    studyPointsLedgerEntry: {
      findFirst: async () => ledgerChanged ? { id: "new-competitive-ledger-entry" } : null,
    },
    $transaction: async () => {
      transactionCalls += 1;
      throw new Error("REBUILD_REQUESTED_IN_TEST");
    },
  } as unknown as PrismaClient;
  return { database, getTransactionCalls: () => transactionCalls };
}

test("Phase 7.5A: unchanged fresh canonical LIVE snapshot never writes a revision", async () => {
  const fake = createDatabase();
  const result = await getReadableLeaderboardSnapshot({ season: season as never, now, database: fake.database });
  assert.equal(result.snapshot.id, snapshot.id);
  assert.equal(result.isStale, false);
  assert.equal(fake.getTransactionCalls(), 0);
});

test("Phase 7.5A: newly committed competitive ledger entry requests a rebuild", async () => {
  const fake = createDatabase({ ledgerChanged: true });
  await assert.rejects(
    getReadableLeaderboardSnapshot({ season: season as never, now, database: fake.database }),
    /REBUILD_REQUESTED_IN_TEST/u,
  );
  assert.equal(fake.getTransactionCalls(), 1);
});

test("Phase 7.5A: active roster change requests a rebuild", async () => {
  const fake = createDatabase({ entryCount: 3 });
  await assert.rejects(
    getReadableLeaderboardSnapshot({ season: season as never, now, database: fake.database }),
    /REBUILD_REQUESTED_IN_TEST/u,
  );
  assert.equal(fake.getTransactionCalls(), 1);
});

test("Phase 7.5A: an expired freshness window requests a rebuild", async () => {
  const fake = createDatabase({ generatedAt: new Date(now.getTime() - 6 * 60_000) });
  await assert.rejects(
    getReadableLeaderboardSnapshot({ season: season as never, now, database: fake.database }),
    /REBUILD_REQUESTED_IN_TEST/u,
  );
  assert.equal(fake.getTransactionCalls(), 1);
});

test("Phase 7.5A: first-page D1 branch is reachable only behind the read flag", () => {
  const code = readFileSync(new URL("../server/features/leaderboard/cacheReads.ts", import.meta.url), "utf8");
  assert.match(code, /const task = getReadableLeaderboardSnapshot\(\{/u);
  assert.doesNotMatch(code, /forceRevision: true/u);
  const firstPage = code.slice(code.indexOf("export async function getLeaderboardPageWithCache"), code.indexOf("export async function getMyLeaderboardRankWithCache"));
  assert.match(firstPage, /if \(!cacheIsEnabled\(\)\) \{\s*return getLeaderboardPage/u);
  assert.match(firstPage, /getCurrentManifest\(season\)/u);
  assert.match(firstPage, /validateManifestForSnapshot\(manifest, season, snapshot\)/u);
  assert.match(firstPage, /warnFallback\(\);\s*return getLeaderboardPage/u);
});
