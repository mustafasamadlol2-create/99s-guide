import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { buildLeaderboardCacheManifest, toCacheEntry } from "../server/features/leaderboard/cacheProtocol.js";
import { getLeaderboardPageWithCache, getMyLeaderboardRankWithCache } from "../server/features/leaderboard/cacheReads.js";
import { decodeLeaderboardCursor } from "../server/features/leaderboard/cursor.js";
import { getLeaderboardRankingSemanticsVersion } from "../server/features/leaderboard/fingerprint.js";
import { getLeaderboardPage, getMyLeaderboardRank } from "../server/features/leaderboard/queries.js";
import { clearOperationalMetricsForTests, getOperationalMetricsSnapshot } from "../server/observability/metrics.js";

const now = new Date("2026-11-24T12:00:00.000Z");
const season = {
  id: "monthly-season",
  scope: "MONTHLY" as const,
  seasonKey: "monthly:2026-11",
  startsAt: new Date("2026-10-31T21:00:00.000Z"),
  endsAt: new Date("2026-11-30T21:00:00.000Z"),
  status: "ACTIVE" as const,
};
const [leader, viewer] = [
  { userId: "leading-student", rank: 1, tieSize: 1, score: 73n, levelSnapshot: 4, user: { name: "Student A" } },
  { userId: "viewing-student", rank: 2, tieSize: 1, score: 21n, levelSnapshot: 2, user: { name: "Student B" } },
] as const;
const rows = [leader, viewer];
const snapshot = {
  id: "monthly-live-snapshot",
  seasonId: season.id,
  status: "READY",
  snapshotType: "LIVE" as const,
  revision: 1,
  generatedAt: new Date(now.getTime() - 60_000),
  scoreThrough: new Date(now.getTime() - 60_000),
  sourceFingerprint: "a".repeat(64),
  rankingSemanticsVersion: getLeaderboardRankingSemanticsVersion(season.scope),
  entryCount: rows.length,
};
const manifest = { ...buildLeaderboardCacheManifest(season, snapshot, rows), state: "READY" };
const cacheHit = { feature: "leaderboard_d1", operation: "request", result: "cache_hit", count: 1 };
const fallback = { feature: "leaderboard_d1", operation: "fallback", result: "fallback", count: 1 };

function mockReads(t: TestContext, options: { blockLeader?: boolean; mismatchedRank?: boolean } = {}) {
  clearOperationalMetricsForTests();
  t.after(clearOperationalMetricsForTests);

  const environment = {
    LEADERBOARD_D1_READ_ENABLED: "true",
    LEADERBOARD_D1_WORKER_URL: "https://leaderboard-cache.invalid",
    LEADERBOARD_D1_SYNC_SECRET: "test-worker-secret",
    SESSION_SECRET: "test-cursor-secret",
    JWT_SECRET: "",
  };
  for (const [key, value] of Object.entries(environment)) {
    const original = process.env[key];
    t.after(() => {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    });
    process.env[key] = value;
  }

  const visibleRows = options.blockLeader ? [viewer] : rows;
  const database = {
    leaderboardSeason: { findUnique: async () => season },
    leaderboardSnapshot: { findFirst: async () => snapshot, findUnique: async () => snapshot },
    leaderboardSnapshotEntry: {
      findFirst: async ({ where }: { where: { userId: string } }) =>
        rows.find((row) => row.userId === where.userId) ?? null,
      findMany: async ({ where, take }: { where: Prisma.LeaderboardSnapshotEntryWhereInput; take: number }) =>
        (where.AND ? visibleRows.filter((row) => row.rank > leader.rank) : visibleRows).slice(0, take),
      count: async () => visibleRows.length,
    },
    user: {
      count: async () => rows.length,
      findMany: async () => visibleRows.map((row) => ({ ...row.user, id: row.userId })),
    },
    userBlock: {
      findMany: async () => options.blockLeader
        ? [{ blockerId: viewer.userId, blockedId: leader.userId }]
        : [],
    },
    studyPointsLedgerEntry: { findFirst: async () => null },
    $transaction: async (read: (tx: object) => Promise<unknown>) => read({
      $executeRaw: async () => 0,
      $queryRaw: async () => [{ score: viewer.score.toString() }],
      leaderboardSeason: { findUniqueOrThrow: async () => season },
    }),
  } as unknown as PrismaClient;
  const input = { database, now, scope: season.scope, viewerId: viewer.userId, limit: 1 };
  const worker = t.mock.method(globalThis, "fetch", async (url: URL) => {
    const result = { ok: true, manifest };
    switch (url.pathname) {
      case "/internal/leaderboard-cache/current":
        return Response.json(result);
      case "/internal/leaderboard-cache/page":
        return Response.json({
          ...result,
          entries: [toCacheEntry(leader)],
          nextCursor: { afterRank: leader.rank, afterScore: Number(leader.score), afterUserId: leader.userId },
        });
      case "/internal/leaderboard-cache/rank":
        return Response.json({ ...result, entry: toCacheEntry(options.mismatchedRank ? leader : viewer) });
      default:
        assert.fail(`Unexpected D1 path ${url.pathname}`);
    }
  });
  return { input, worker };
}

function captureReadLogs(t: TestContext) {
  const logs: Array<{ level: string; message: string }> = [];
  const capture = (json: string) => {
    const entry = JSON.parse(json);
    assert.equal(entry.category, "[LeaderboardD1]");
    assert.equal(entry.userId, null);
    assert.equal(entry.details, null);
    logs.push({ level: entry.level, message: entry.message });
  };
  t.mock.method(console, "log", capture);
  t.mock.method(console, "warn", capture);
  return logs;
}

test("validated D1 page records one cache hit and preserves ranking and cursor data", async (t) => {
  const { input, worker } = mockReads(t);
  const logs = captureReadLogs(t);
  const actual = await getLeaderboardPageWithCache(input);
  const expected = await getLeaderboardPage(input);

  assert.equal(worker.mock.callCount(), 2);
  assert.deepEqual(getOperationalMetricsSnapshot().outcomes, [cacheHit]);
  assert.deepEqual(logs, [{ level: "INFO", message: "[LeaderboardD1] READ_SUCCESS scope=MONTHLY endpoint=page source=D1" }]);
  assert.deepEqual(
    { ...actual, nextCursor: decodeLeaderboardCursor(actual.nextCursor, now.getTime()) },
    { ...expected, nextCursor: decodeLeaderboardCursor(expected.nextCursor, now.getTime()) },
  );
});

test("validated D1 own rank records one cache hit and preserves the response", async (t) => {
  const { input, worker } = mockReads(t);
  const logs = captureReadLogs(t);

  assert.deepEqual(await getMyLeaderboardRankWithCache(input), await getMyLeaderboardRank(input));
  assert.equal(worker.mock.callCount(), 2);
  assert.deepEqual(getOperationalMetricsSnapshot().outcomes, [cacheHit]);
  assert.deepEqual(logs, [{ level: "INFO", message: "[LeaderboardD1] READ_SUCCESS scope=MONTHLY endpoint=own_rank source=D1" }]);
});

test("a D1 page rejected by the visibility check falls back without a cache hit", async (t) => {
  const { input, worker } = mockReads(t, { blockLeader: true });
  const logs = captureReadLogs(t);
  const actual = await getLeaderboardPageWithCache(input);

  assert.deepEqual(actual, await getLeaderboardPage(input));
  assert.equal(actual.entries[0]?.isViewer, true);
  assert.equal(worker.mock.callCount(), 2);
  assert.deepEqual(getOperationalMetricsSnapshot().outcomes, [fallback]);
  assert.deepEqual(logs, [{ level: "WARNING", message: "[LeaderboardD1] READ_FALLBACK scope=MONTHLY endpoint=page source=PostgreSQL" }]);
});

test("a D1 rank row for another user falls back without a cache hit", async (t) => {
  const { input, worker } = mockReads(t, { mismatchedRank: true });
  const logs = captureReadLogs(t);

  assert.deepEqual(await getMyLeaderboardRankWithCache(input), await getMyLeaderboardRank(input));
  assert.equal(worker.mock.callCount(), 2);
  assert.deepEqual(getOperationalMetricsSnapshot().outcomes, [fallback]);
  assert.deepEqual(logs, [{ level: "WARNING", message: "[LeaderboardD1] READ_FALLBACK scope=MONTHLY endpoint=own_rank source=PostgreSQL" }]);
});

test("a D1 page whose cursor cannot be constructed records no read outcome", async (t) => {
  const { input, worker } = mockReads(t);
  const logs = captureReadLogs(t);
  delete process.env.SESSION_SECRET;

  await assert.rejects(getLeaderboardPageWithCache(input), { code: "LEADERBOARD_CURSOR_CONFIGURATION_MISSING" });
  assert.equal(worker.mock.callCount(), 2);
  assert.deepEqual(getOperationalMetricsSnapshot().outcomes, []);
  assert.deepEqual(logs, []);
});

test("disabled D1 reads log only intentional canonical reads and make no Worker calls", async (t) => {
  const { input, worker } = mockReads(t);
  const logs = captureReadLogs(t);
  process.env.LEADERBOARD_D1_READ_ENABLED = "false";
  const firstPage = await getLeaderboardPageWithCache(input);
  const cursor = decodeLeaderboardCursor(firstPage.nextCursor, now.getTime());

  assert.deepEqual(await getLeaderboardPageWithCache({ ...input, cursor }), await getLeaderboardPage({ ...input, cursor }));
  assert.deepEqual(await getMyLeaderboardRankWithCache(input), await getMyLeaderboardRank(input));
  assert.equal(worker.mock.callCount(), 0);
  assert.deepEqual(getOperationalMetricsSnapshot().outcomes, []);
  assert.deepEqual(logs, [
    { level: "INFO", message: "[LeaderboardD1] READ_CANONICAL scope=MONTHLY endpoint=page source=PostgreSQL" },
    { level: "INFO", message: "[LeaderboardD1] READ_CANONICAL scope=MONTHLY endpoint=page source=PostgreSQL" },
    { level: "INFO", message: "[LeaderboardD1] READ_CANONICAL scope=MONTHLY endpoint=own_rank source=PostgreSQL" },
  ]);
});

test("logging failures leave D1 success, fallback, and intentional canonical reads intact", async (t) => {
  const { input, worker } = mockReads(t, { mismatchedRank: true });
  const failLog = () => { throw new Error("Log output failed"); };
  const info = t.mock.method(console, "log", failLog);
  const warn = t.mock.method(console, "warn", failLog);

  const page = await getLeaderboardPageWithCache(input);
  assert.equal(page.entries[0]?.score, Number(leader.score));
  assert.ok(page.nextCursor);
  const canonicalRank = await getMyLeaderboardRank(input);
  assert.deepEqual(await getMyLeaderboardRankWithCache(input), canonicalRank);
  process.env.LEADERBOARD_D1_READ_ENABLED = "false";
  assert.deepEqual(await getMyLeaderboardRankWithCache(input), canonicalRank);
  assert.equal(worker.mock.callCount(), 4);
  assert.equal(info.mock.callCount(), 2);
  assert.equal(warn.mock.callCount(), 1);
  assert.deepEqual(getOperationalMetricsSnapshot().outcomes, [fallback, cacheHit]);
});
