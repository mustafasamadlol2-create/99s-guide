import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import { buildLeaderboardCacheManifest, toCacheEntry } from "../server/features/leaderboard/cacheProtocol.js";
import { getLeaderboardPageWithCache, getMyLeaderboardRankWithCache } from "../server/features/leaderboard/cacheReads.js";
import { decodeLeaderboardCursor } from "../server/features/leaderboard/cursor.js";
import { enqueueLeaderboardSnapshotProjection } from "../server/features/leaderboard/d1Outbox.js";
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
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  updatedAt: new Date("2026-11-01T00:00:00.000Z"),
  closedAt: null,
  gamificationRuleSetVersion: null,
  pointsRuleVersionSetHash: "b".repeat(64),
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
  pointsRuleVersionSetHash: "b".repeat(64),
  supersedesSnapshotId: null,
  createdAt: new Date(now.getTime() - 60_000),
};
const cacheHit = { feature: "leaderboard_d1", operation: "request", result: "cache_hit", count: 1 };
const fallback = { feature: "leaderboard_d1", operation: "fallback", result: "fallback", count: 1 };

type MockReadOptions = {
  blockLeader?: boolean;
  mismatchedRank?: boolean;
  change?: "ledger" | "roster" | "season_close" | "query_failure";
  workerFailure?: "missing" | "pointer_lag" | "auth" | "timeout" | "transport" | "invalid" | "unknown";
  ageMs?: number;
};

function jsonBytes(value: unknown): number {
  if (value == null) return 0;
  return Buffer.byteLength(JSON.stringify(value, (_, field) =>
    typeof field === "bigint" ? field.toString() : field));
}

function mockReads(t: TestContext, options: MockReadOptions = {}) {
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

  const live = options.ageMs === undefined ? snapshot : {
    ...snapshot,
    generatedAt: new Date(now.getTime() - options.ageMs),
    scoreThrough: new Date(now.getTime() - options.ageMs),
  };
  const final = { ...snapshot, id: "monthly-final-snapshot", snapshotType: "FINAL" as const };
  const closed = { ...season, status: "CLOSED" as const, closedAt: now };
  const refreshed = { ...snapshot, id: "monthly-refreshed-snapshot", revision: 2, generatedAt: now,
    entryCount: options.change === "roster" ? rows.length + 1 : rows.length };
  const workerManifest = options.change === "season_close"
    ? { ...buildLeaderboardCacheManifest(closed, final, rows), state: "READY" }
    : { ...buildLeaderboardCacheManifest(season, live, rows), state: "READY" };
  let leaderBlocked = false;
  const visibleRows = () => leaderBlocked ? [viewer] : rows;
  let seasonReads = 0;
  let snapshotReads = 0;
  let seasonTransactions = 0;
  let calls = 0;
  let bytes = 0;
  type Selection = Record<string, unknown>;
  const snapshotSelections: Array<Selection | undefined> = [];
  const observe = <T,>(value: T, select?: Selection): T => {
    const selected = value && typeof value === "object" && !Array.isArray(value) && select
      ? Object.fromEntries(Object.entries(value).filter(([key]) => select[key])) as T
      : value;
    calls++;
    bytes += jsonBytes(selected);
    return selected;
  };
  const readSeason = async () => {
    seasonReads++;
    return observe(options.change === "season_close" && seasonReads > 1 ? closed : season);
  };
  const database = {
    leaderboardSeason: { findUnique: readSeason },
    leaderboardSnapshot: {
      findFirst: async ({ where, select }: { where: { snapshotType: string }; select?: Selection }) => {
        snapshotReads++;
        snapshotSelections.push(select);
        if (options.change === "query_failure" && snapshotReads === 2) {
          calls++;
          throw new Prisma.PrismaClientKnownRequestError("synthetic private connection detail", {
            code: "P2024",
            clientVersion: "test",
          });
        }
        if (where.snapshotType === "FINAL") return observe(final, select);
        if ((options.change === "ledger" || options.change === "roster") && snapshotReads > 2) {
          return observe(refreshed, select);
        }
        return observe(live, select);
      },
      findUnique: async ({ select }: { select?: Selection }) => {
        snapshotSelections.push(select);
        return observe(live, select);
      },
    },
    leaderboardSnapshotEntry: {
      findFirst: async ({ where, select }: { where: { userId: string }; select?: Selection }) =>
        observe(rows.find((row) => row.userId === where.userId) ?? null, select),
      findMany: async ({ where, take }: { where: Prisma.LeaderboardSnapshotEntryWhereInput; take: number }) =>
        observe((where.AND ? visibleRows().filter((row) => row.rank > leader.rank) : visibleRows()).slice(0, take)),
      count: async () => observe(visibleRows().length + Number(options.change === "roster" && snapshotReads > 2)),
    },
    user: {
      count: async () => observe(rows.length + Number(options.change === "roster" && snapshotReads > 1)),
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        observe(visibleRows().filter((row) => where.id.in.includes(row.userId))
          .map((row) => ({ ...row.user, id: row.userId, avatar: null, avatarUrl: null }))),
    },
    userBlock: {
      findMany: async () => observe(leaderBlocked
        ? [{ blockerId: viewer.userId, blockedId: leader.userId }]
        : []),
    },
    studyPointsLedgerEntry: {
      findFirst: async () => observe(options.change === "ledger" && snapshotReads === 2
        ? { id: "concurrent-competitive-entry" }
        : null),
    },
    $transaction: async (read: (tx: object) => Promise<unknown>) => read({
      $executeRaw: async () => { seasonTransactions++; return observe(0); },
      $queryRaw: async (sql: { text?: string }) => observe(sql.text?.includes("pg_try_advisory_xact_lock")
        ? [{ locked: false }]
        : [{ score: viewer.score.toString() }]),
      leaderboardSeason: { findUniqueOrThrow: readSeason },
    }),
  } as unknown as PrismaClient;
  const input = { database, now, scope: season.scope, viewerId: viewer.userId, limit: 1 };
  const worker = t.mock.method(globalThis, "fetch", async (url: URL) => {
    const result = { ok: true, manifest: workerManifest };
    switch (url.pathname) {
      case "/internal/leaderboard-cache/current":
        if (options.workerFailure === "missing") return Response.json({ ...result, manifest: null });
        if (options.workerFailure === "pointer_lag") {
          return Response.json({ ...result, manifest: { ...workerManifest, snapshotId: "previous-snapshot" } });
        }
        if (options.workerFailure === "auth") {
          return Response.json({ code: "LEADERBOARD_CACHE_UNAUTHORIZED" }, { status: 401 });
        }
        if (options.workerFailure === "timeout") throw new DOMException("private timeout detail", "TimeoutError");
        if (options.workerFailure === "transport") throw new TypeError("fetch failed");
        if (options.workerFailure === "invalid") return new Response("{");
        if (options.workerFailure === "unknown") throw new Error("unclassifiable private detail");
        return Response.json(result);
      case "/internal/leaderboard-cache/page":
        if (options.blockLeader) leaderBlocked = true;
        if (url.searchParams.has("afterRank")) {
          return Response.json({ ...result, entries: [toCacheEntry(viewer)], nextCursor: null });
        }
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
  return { input, worker, snapshotSelections, totals: () => ({ calls, bytes, seasonTransactions }) };
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
  const { input, worker, totals } = mockReads(t);
  const logs = captureReadLogs(t);
  const actual = await getLeaderboardPageWithCache(input);
  assert.equal(totals().seasonTransactions, 1);
  assert.equal(totals().calls, 13);
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
  const { input, worker, snapshotSelections } = mockReads(t);
  const logs = captureReadLogs(t);

  const actual = await getMyLeaderboardRankWithCache(input);
  assert.equal(snapshotSelections.length, 2);
  for (const select of snapshotSelections) {
    assert.ok(select?.rankingSemanticsVersion && select.sourceFingerprint && select.scoreThrough);
    assert.equal(select.pointsRuleVersionSetHash, undefined);
    assert.equal(select.supersedesSnapshotId, undefined);
    assert.equal(select.createdAt, undefined);
  }
  assert.deepEqual(actual, await getMyLeaderboardRank(input));
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
  assert.deepEqual(logs, [{ level: "WARNING", message: "[LeaderboardD1] READ_FALLBACK scope=MONTHLY endpoint=page source=PostgreSQL reason=VISIBILITY_FILTER" }]);
});

test("a D1 rank row for another user falls back without a cache hit", async (t) => {
  const { input, worker } = mockReads(t, { mismatchedRank: true });
  const logs = captureReadLogs(t);

  assert.deepEqual(await getMyLeaderboardRankWithCache(input), await getMyLeaderboardRank(input));
  assert.equal(worker.mock.callCount(), 2);
  assert.deepEqual(getOperationalMetricsSnapshot().outcomes, [fallback]);
  assert.deepEqual(logs, [{ level: "WARNING", message: "[LeaderboardD1] READ_FALLBACK scope=MONTHLY endpoint=own_rank source=PostgreSQL reason=WORKER_RESPONSE_INVALID" }]);
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

test("the first-page season recheck observes a close after the LIVE preflight", async (t) => {
  const { input, totals, worker } = mockReads(t, { change: "season_close" });
  captureReadLogs(t);
  const page = await getLeaderboardPageWithCache(input);
  assert.equal(page.season.status, "CLOSED");
  assert.equal(decodeLeaderboardCursor(page.nextCursor, now.getTime()).expiresAt, null);
  assert.equal(worker.mock.callCount(), 2);
  assert.equal(totals().seasonTransactions, 1);
  assert.deepEqual(getOperationalMetricsSnapshot().outcomes, [cacheHit]);
});

test("the later ledger check rejects a D1 page when a ledger entry arrives after preflight", async (t) => {
  const { input } = mockReads(t, { change: "ledger" });
  const logs = captureReadLogs(t);
  const page = await getLeaderboardPageWithCache(input);
  assert.equal(page.generatedAt, now.toISOString());
  assert.deepEqual(getOperationalMetricsSnapshot().outcomes, [fallback]);
  assert.match(logs[0]?.message ?? "", /reason=CANONICAL_CHANGED$/u);
});

test("the later roster check rejects D1 own rank when the roster changes after preflight", async (t) => {
  const { input } = mockReads(t, { change: "roster" });
  const logs = captureReadLogs(t);
  const rank = await getMyLeaderboardRankWithCache(input);
  assert.equal(rank.totalRankedUsers, 3);
  assert.equal(rank.snapshotGeneratedAt, now.toISOString());
  assert.deepEqual(getOperationalMetricsSnapshot().outcomes, [fallback]);
  assert.match(logs[0]?.message ?? "", /reason=CANONICAL_CHANGED$/u);
});

test("an over-age D1 snapshot uses the existing stale canonical fallback when refresh is locked", async (t) => {
  const { input } = mockReads(t, { ageMs: 16 * 60_000 });
  const logs = captureReadLogs(t);
  const page = await getLeaderboardPageWithCache(input);
  assert.equal(page.isStale, true);
  assert.equal(page.nextCursor, null);
  assert.deepEqual(getOperationalMetricsSnapshot().outcomes, [fallback]);
  assert.match(logs[0]?.message ?? "", /reason=LIVE_STALE$/u);
});

test("a pinned cursor keeps its ranking and can still use D1 within the hard-stale window", async (t) => {
  const ageMs = 6 * 60_000;
  const { input, worker } = mockReads(t, { ageMs });
  captureReadLogs(t);
  const cursor = fixtureCursor(ageMs);
  const nextInput = { ...input, cursor };
  const page = await getLeaderboardPageWithCache(nextInput);
  assert.equal(page.isStale, true);
  assert.deepEqual(page, await getLeaderboardPage(nextInput));
  assert.equal(worker.mock.callCount(), 1);
  assert.deepEqual(getOperationalMetricsSnapshot().outcomes, [cacheHit]);
});

test("known Prisma failures fall back with a bounded canonical reason", async (t) => {
  const { input } = mockReads(t, { change: "query_failure" });
  const logs = captureReadLogs(t);
  assert.deepEqual(await getMyLeaderboardRankWithCache(input), await getMyLeaderboardRank(input));
  assert.deepEqual(getOperationalMetricsSnapshot().outcomes, [fallback]);
  assert.match(logs[0]?.message ?? "", /reason=CANONICAL_QUERY_FAILED$/u);
});

test("a missing Worker configuration falls back before sending an HTTP request", async (t) => {
  const { input, worker } = mockReads(t);
  const logs = captureReadLogs(t);
  delete process.env.LEADERBOARD_D1_SYNC_SECRET;
  assert.deepEqual(await getMyLeaderboardRankWithCache(input), await getMyLeaderboardRank(input));
  assert.equal(worker.mock.callCount(), 0);
  assert.deepEqual(getOperationalMetricsSnapshot().outcomes, [fallback]);
  assert.match(logs[0]?.message ?? "", /reason=WORKER_CONFIGURATION$/u);
});

for (const [workerFailure, reason] of [
  ["missing", "PROJECTION_NOT_READY"],
  ["pointer_lag", "PROJECTION_POINTER_MISMATCH"],
  ["auth", "WORKER_AUTH"],
  ["timeout", "WORKER_TIMEOUT"],
  ["transport", "WORKER_TRANSPORT"],
  ["invalid", "WORKER_RESPONSE_INVALID"],
  ["unknown", "UNKNOWN"],
] as const) {
  test("Worker " + workerFailure + " uses canonical rank and a sanitized reason", async (t) => {
    const { input } = mockReads(t, { workerFailure });
    const logs = captureReadLogs(t);
    assert.deepEqual(await getMyLeaderboardRankWithCache(input), await getMyLeaderboardRank(input));
    assert.deepEqual(getOperationalMetricsSnapshot().outcomes, [fallback]);
    assert.deepEqual(logs, [{
      level: "WARNING",
      message: "[LeaderboardD1] READ_FALLBACK scope=MONTHLY endpoint=own_rank source=PostgreSQL reason=" + reason,
    }]);
  });
}

function fixtureCursor(ageMs = 60_000): NonNullable<Parameters<typeof getLeaderboardPageWithCache>[0]["cursor"]> {
  return {
    version: 1,
    snapshotId: snapshot.id,
    seasonId: season.id,
    rank: leader.rank,
    score: leader.score.toString(),
    userId: leader.userId,
    expiresAt: now.getTime() - ageMs + 15 * 60_000,
  };
}

for (const scenario of ["page", "own-rank", "cursor", "page-fallback", "canonical-rank", "direct-postgres-rank"] as const) {
  test("egress fixture: " + scenario, async (t) => {
    const { input, totals } = mockReads(t, { blockLeader: scenario === "page-fallback" });
    captureReadLogs(t);
    if (scenario === "canonical-rank") process.env.LEADERBOARD_D1_READ_ENABLED = "false";
    const started = performance.now();
    if (scenario === "direct-postgres-rank") {
      await getMyLeaderboardRank(input);
    } else if (scenario === "own-rank" || scenario === "canonical-rank") {
      await getMyLeaderboardRankWithCache(input);
    } else {
      await getLeaderboardPageWithCache({
        ...input,
        ...(scenario === "cursor" ? { cursor: fixtureCursor() } : {}),
      });
    }
    t.diagnostic(JSON.stringify({
      scenario, ...totals(), fixtureLatencyMs: Math.round((performance.now() - started) * 100) / 100,
      outcomes: getOperationalMetricsSnapshot().outcomes,
    }));
  });
}

async function sampleProjection(t: TestContext) {
  mockReads(t);
  const flag = "LEADERBOARD_D1_PROJECTION_ENABLED";
  const previous = process.env[flag];
  t.after(() => {
    if (previous === undefined) delete process.env[flag];
    else process.env[flag] = previous;
  });
  process.env[flag] = "true";
  const ranked = Array.from({ length: 123 }, (_, index) => ({
    userId: "synthetic-student-" + index.toString().padStart(3, "0"),
    rank: index + 1,
    score: BigInt(123 - index),
    tieSize: 1,
    levelSnapshot: 1,
  }));
  const payloads: unknown[] = [];
  const selections: Array<{ id?: boolean } | undefined> = [];
  let returnedBytes = 0;
  const tx = {
    leaderboardD1SyncOutbox: {
      upsert: async ({ create, select }: { create: { payload: unknown }; select?: { id?: boolean } }) => {
        payloads.push(create.payload);
        selections.push(select);
        const id = BigInt(payloads.length);
        const returned = select?.id ? { id } : { id, payload: create.payload };
        returnedBytes += jsonBytes(returned);
        return returned;
      },
    },
  } as unknown as Prisma.TransactionClient;
  assert.equal(await enqueueLeaderboardSnapshotProjection(tx, {
    season,
    snapshot: { ...snapshot, entryCount: ranked.length },
    entries: ranked,
  }), true);
  assert.equal(payloads.length, 4);
  return { payloads, selections, returnedBytes };
}

test("projection enqueues all rows and only asks PostgreSQL to return the outbox ID", async (t) => {
  const { payloads, selections } = await sampleProjection(t);
  assert.deepEqual(selections, Array.from({ length: 4 }, () => ({ id: true })));
  assert.deepEqual(payloads.map((payload) => Object.keys(payload as object)), [
    ["manifest"], ["manifest", "chunkIndex", "entries", "chunkHash"],
    ["manifest", "chunkIndex", "entries", "chunkHash"], ["manifest"],
  ]);
});

test("egress fixture: projection", async (t) => {
  const { payloads, returnedBytes } = await sampleProjection(t);
  t.diagnostic(JSON.stringify({
    scenario: "projection",
    enqueueCalls: payloads.length,
    estimatedEnqueueResultBytes: returnedBytes,
    estimatedLeasePayloadBytes: payloads.reduce<number>((bytes, payload) => bytes + jsonBytes(payload), 0),
  }));
});
