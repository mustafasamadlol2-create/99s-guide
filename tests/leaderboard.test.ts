import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { performance } from "node:perf_hooks";
import { Prisma, type PrismaClient } from "@prisma/client";
import test from "node:test";
import { decodeLeaderboardCursor, encodeLeaderboardCursor } from "../server/features/leaderboard/cursor.js";
import { fingerprintLeaderboardSnapshot, hashLeaderboardRuleVersions } from "../server/features/leaderboard/fingerprint.js";
import { LeaderboardError } from "../server/features/leaderboard/errors.js";
import {
  getAvailableLeaderboardScopes,
  getLeaderboardSeasonWindow,
  SERVER_OWNED_SEMESTER_BOUNDARIES,
  validateSeasonKey,
} from "../server/features/leaderboard/periods.js";
import { getLeaderboardPageWithCache } from "../server/features/leaderboard/cacheReads.js";
import { resolveSeason } from "../server/features/leaderboard/queries.js";
import { readRankedLeaderboardScores, readUserLeaderboardScore } from "../server/features/leaderboard/scores.js";
import type { RankedScore } from "../server/features/leaderboard/types.js";
import {
  createAdminLeaderboardRouter,
  createLeaderboardRouter,
} from "../server/routes/leaderboards.js";

const weekly = getLeaderboardSeasonWindow(
  "WEEKLY",
  new Date("2026-09-24T20:59:59.999Z"),
);

function querySource(query: unknown): string {
  if (Array.isArray(query)) return query.join("<value>");
  if (query && typeof query === "object" && "sql" in query) {
    return String((query as { sql: unknown }).sql);
  }
  return String(query);
}

test("Baghdad weekly and monthly boundaries are exact and half-open", () => {
  const beforeMonday = getLeaderboardSeasonWindow(
    "WEEKLY",
    new Date("2026-09-27T20:59:59.999Z"),
  );
  const monday = getLeaderboardSeasonWindow(
    "WEEKLY",
    new Date("2026-09-27T21:00:00.000Z"),
  );
  assert.equal(beforeMonday.seasonKey, "weekly:2026-W39");
  assert.equal(monday.seasonKey, "weekly:2026-W40");
  assert.equal(beforeMonday.endsAt?.getTime(), monday.startsAt?.getTime());

  const beforeMonth = getLeaderboardSeasonWindow(
    "MONTHLY",
    new Date("2026-09-30T20:59:59.999Z"),
  );
  const october = getLeaderboardSeasonWindow(
    "MONTHLY",
    new Date("2026-09-30T21:00:00.000Z"),
  );
  assert.equal(beforeMonth.seasonKey, "monthly:2026-09");
  assert.equal(october.seasonKey, "monthly:2026-10");
  assert.equal(beforeMonth.endsAt?.getTime(), october.startsAt?.getTime());
});

test("configured semester ranges use Baghdad-local inclusive dates and half-open instants", () => {
  assert.deepEqual(
    SERVER_OWNED_SEMESTER_BOUNDARIES.map((boundary) => [
      boundary.seasonKey,
      boundary.startsAt.toISOString(),
      boundary.endsAt.toISOString(),
    ]),
    [
      [
        "semester:fall-2026",
        "2026-08-31T21:00:00.000Z",
        "2027-01-31T21:00:00.000Z",
      ],
      [
        "semester:spring-2027",
        "2027-01-31T21:00:00.000Z",
        "2027-06-30T21:00:00.000Z",
      ],
    ],
  );
  assert.throws(
    () => getLeaderboardSeasonWindow(
      "SEMESTER",
      new Date("2026-08-31T20:59:59.999Z"),
    ),
    (error: unknown) =>
      error instanceof LeaderboardError
      && error.code === "LEADERBOARD_SEASON_CONFIGURATION_MISSING",
  );
  const fall = getLeaderboardSeasonWindow(
    "SEMESTER",
    new Date("2026-08-31T21:00:00.000Z"),
  );
  const lastMomentOfFall = getLeaderboardSeasonWindow(
    "SEMESTER",
    new Date("2027-01-31T20:59:59.999Z"),
  );
  const spring = getLeaderboardSeasonWindow(
    "SEMESTER",
    new Date("2027-01-31T21:00:00.000Z"),
  );
  const lastMomentOfSpring = getLeaderboardSeasonWindow(
    "SEMESTER",
    new Date("2027-06-30T20:59:59.999Z"),
  );
  assert.equal(fall.seasonKey, "semester:fall-2026");
  assert.equal(lastMomentOfFall.seasonKey, "semester:fall-2026");
  assert.equal(spring.seasonKey, "semester:spring-2027");
  assert.equal(lastMomentOfSpring.seasonKey, "semester:spring-2027");
  assert.equal(fall.startsAt?.toISOString(), "2026-08-31T21:00:00.000Z");
  assert.equal(fall.endsAt?.getTime(), spring.startsAt?.getTime());
  assert.equal(validateSeasonKey("SEMESTER", "semester:fall-2026"), true);
  assert.equal(validateSeasonKey("WEEKLY", "weekly:2026-W00"), false);
});

test("semester availability hides the scope when no configured term is active", () => {
  const active = getAvailableLeaderboardScopes(
    new Date("2026-10-09T12:00:00.000Z"),
  );
  const outsideConfiguredTerms = getAvailableLeaderboardScopes(
    new Date("2027-07-01T00:00:00.000Z"),
  );
  const noConfiguration = getAvailableLeaderboardScopes(
    new Date("2026-10-09T12:00:00.000Z"),
    [],
  );
  assert.deepEqual(active, ["WEEKLY", "MONTHLY", "SEMESTER", "ALL_TIME"]);
  assert.deepEqual(outsideConfiguredTerms, ["WEEKLY", "MONTHLY", "ALL_TIME"]);
  assert.deepEqual(noConfiguration, ["WEEKLY", "MONTHLY", "ALL_TIME"]);
});

test("a past closed semester resolves by its canonical stored key", async () => {
  const storedSeason = {
    id: "fall-2026-season",
    scope: "SEMESTER",
    seasonKey: "semester:fall-2026",
    startsAt: new Date("2026-08-31T21:00:00.000Z"),
    endsAt: new Date("2027-01-31T21:00:00.000Z"),
    status: "CLOSED",
  };
  const lookups: unknown[] = [];
  const database = {
    leaderboardSeason: {
      async findUnique(input: unknown) {
        lookups.push(input);
        return storedSeason;
      },
    },
  } as unknown as PrismaClient;
  const resolved = await resolveSeason({
    scope: "SEMESTER",
    seasonKey: "semester:fall-2026",
    now: new Date("2027-03-01T12:00:00.000Z"),
    database,
  });
  assert.equal(resolved.id, storedSeason.id);
  assert.deepEqual(lookups, [{
    where: {
      scope_seasonKey: {
        scope: "SEMESTER",
        seasonKey: "semester:fall-2026",
      },
    },
  }]);
});

test("competition rank fixtures share ties, skip occupied ranks, and exclude nonpositive scores", () => {
  const fixtures = [
    { userId: "a", score: 100n },
    { userId: "d", score: 60n },
    { userId: "c", score: 80n },
    { userId: "b", score: 80n },
    { userId: "zero", score: 0n },
    { userId: "negative", score: -5n },
  ].filter((row) => row.score > 0n)
    .sort((left, right) =>
      left.score === right.score
        ? left.userId.localeCompare(right.userId)
        : left.score > right.score ? -1 : 1);
  const expectedRanks = [1, 2, 2, 4];
  const actualRanks: number[] = [];
  let previous: bigint | null = null;
  for (let index = 0; index < fixtures.length; index += 1) {
    const score = fixtures[index]!.score;
    if (score !== previous) actualRanks.push(index + 1);
    else actualRanks.push(actualRanks[index - 1]!);
    previous = score;
  }
  assert.deepEqual(actualRanks, expectedRanks);
  assert.deepEqual(fixtures.map(({ userId }) => userId), ["a", "b", "c", "d"]);

  const multipleTieScores = [100, 100, 100, 90];
  const multipleTieRanks: number[] = [];
  for (let index = 0; index < multipleTieScores.length; index += 1) {
    multipleTieRanks.push(
      index === 0 || multipleTieScores[index] !== multipleTieScores[index - 1]
        ? index + 1
        : multipleTieRanks[index - 1]!,
    );
  }
  assert.deepEqual(multipleTieRanks, [1, 1, 1, 4]);
});

test("bounded score query uses one set-based canonical-ledger ranking query", async () => {
  const sqlStatements: string[] = [];
  const rankedRows = [
    { userId: "user-a", score: "100", rank: 1, tieSize: 1, ruleVersions: ["focus-points-v1"] },
    { userId: "user-b", score: "80", rank: 2, tieSize: 2, ruleVersions: ["focus-points-v1"] },
    { userId: "user-c", score: "80", rank: 2, tieSize: 2, ruleVersions: ["focus-points-v1"] },
    { userId: "user-d", score: "60", rank: 4, tieSize: 1, ruleVersions: ["focus-points-v1"] },
  ];
  const tx = {
    async $queryRaw(query: unknown) {
      const sql = querySource(query);
      sqlStatements.push(sql);
      return rankedRows;
    },
  } as unknown as Prisma.TransactionClient;
  const start = weekly.startsAt!;
  const end = weekly.endsAt!;
  const result = await readRankedLeaderboardScores({
    scope: "WEEKLY",
    season: weekly,
    scoreThrough: end,
  }, tx);
  const scoreQuery = sqlStatements.find((sql) => sql.includes("WITH period_points")) ?? "";
  assert.match(scoreQuery, /"effectiveAt" >=/u);
  assert.match(scoreQuery, /"effectiveAt" </u);
  assert.match(scoreQuery, /"PointsLog"/u);
  assert.match(scoreQuery, /'legacy\.points_log'/u);
  assert.match(scoreQuery, /RANK\(\) OVER/u);
  assert.match(scoreQuery, /COUNT\(\*\) OVER \(PARTITION BY eligible\.score\)/u);
  assert.match(scoreQuery, /scores\.score > 0/u);
  assert.match(scoreQuery, /"accountStatus" = 'ACTIVE'/u);
  assert.equal(sqlStatements.filter((sql) => sql.includes("WITH period_points")).length, 1);
  assert.deepEqual(result.rows.map((row) => row.rank), [1, 2, 2, 4]);
  assert.deepEqual(result.rows.map((row) => row.score), [100n, 80n, 80n, 60n]);
  assert.deepEqual(result.ruleVersions, ["focus-points-v1"]);
  assert.ok(end > start);
});

test("All-Time set query preserves the configured legacy-plus-ledger read mode", async () => {
  const sqlStatements: string[] = [];
  const tx = {
    async $queryRaw(query: unknown) {
      const sql = querySource(query);
      sqlStatements.push(sql);
      if (sql.includes("legacy.baseline_import")) return [{ ready: true }];
      return [{
        userId: "user-1",
        score: "140",
        rank: 1,
        tieSize: 1,
        ruleVersions: ["focus-v1", "study-v2"],
      }];
    },
  } as unknown as Prisma.TransactionClient;
  const result = await readRankedLeaderboardScores({
    scope: "ALL_TIME",
    season: { scope: "ALL_TIME", seasonKey: "all-time", startsAt: null, endsAt: null },
    scoreThrough: new Date("2026-09-25T12:00:00Z"),
    compatibilityMode: "LEGACY_PLUS_LEDGER",
  }, tx);
  const combinedQuery = sqlStatements.find((sql) => sql.includes("FULL OUTER JOIN")) ?? "";
  assert.match(combinedQuery, /"User"/u);
  assert.match(combinedQuery, /"StudyPointsLedgerEntry"/u);
  assert.match(combinedQuery, /"totalPoints"/u);
  assert.match(combinedQuery, /"createdAt" <=/u);
  assert.doesNotMatch(combinedQuery, /"PointsLog"/u);
  assert.equal(result.rows[0]?.score, 140n);
  assert.equal(result.compatibilityMode, "LEGACY_PLUS_LEDGER");
  assert.deepEqual(result.ruleVersions, ["focus-v1", "study-v2"]);
});

test("own All-Time score sums compatible sources as of the pinned snapshot time", async () => {
  const queries: string[] = [];
  const tx = {
    async $queryRaw(query: unknown) {
      const sql = querySource(query);
      queries.push(sql);
      if (sql.includes("legacy.baseline_import")) return [{ ready: true }];
      return [{ legacy: "100", ledger: "40" }];
    },
  } as unknown as Prisma.TransactionClient;
  const database = {
    async $transaction(run: (transaction: Prisma.TransactionClient) => Promise<unknown>) {
      return run(tx);
    },
  } as unknown as PrismaClient;
  const score = await readUserLeaderboardScore({
    userId: "user-1",
    scope: "ALL_TIME",
    season: { scope: "ALL_TIME", seasonKey: "all-time", startsAt: null, endsAt: null },
    scoreThrough: new Date("2026-09-25T12:00:00Z"),
    compatibilityMode: "LEGACY_PLUS_LEDGER",
  }, database);
  assert.equal(score.score, 140);
  assert.equal(score.compatibilityMode, "LEGACY_PLUS_LEDGER");
  assert.equal(queries.filter((sql) => sql.includes("AS legacy")).length, 1);
});

test("fingerprints ignore input row order but change when canonical score inputs change", () => {
  const rows: RankedScore[] = [
    { userId: "a", score: 100n, rank: 1, tieSize: 1, levelSnapshot: 8 },
    { userId: "b", score: 80n, rank: 2, tieSize: 2, levelSnapshot: 4 },
  ];
  const input = {
    season: {
      id: "season-1",
      scope: "WEEKLY",
      seasonKey: "weekly:2026-W39",
      startsAt: weekly.startsAt,
      endsAt: weekly.endsAt,
    },
    scoreThrough: new Date("2026-09-25T12:00:00Z"),
    pointsRuleVersionSetHash: hashLeaderboardRuleVersions(["focus-v1", "study-v2"]),
    compatibilityMode: null,
  };
  const first = fingerprintLeaderboardSnapshot({ ...input, rows });
  const reversed = fingerprintLeaderboardSnapshot({ ...input, rows: [...rows].reverse() });
  const changed = fingerprintLeaderboardSnapshot({
    ...input,
    rows: rows.map((row, index) => index === 0 ? { ...row, score: 101n } : row),
  });
  assert.equal(first, reversed);
  assert.notEqual(first, changed);
  assert.equal(
    hashLeaderboardRuleVersions(["study-v2", "focus-v1", "focus-v1"]),
    hashLeaderboardRuleVersions(["focus-v1", "study-v2"]),
  );
});

test("cursor rejects tampering, noncanonical encoding, unsafe scores, and expiry", () => {
  const payload = {
    version: 1 as const,
    snapshotId: "snapshot-1",
    seasonId: "season-1",
    rank: 2,
    score: "80",
    userId: "user-b",
    expiresAt: 2_000,
  };
  const encoded = encodeLeaderboardCursor(payload);
  assert.deepEqual(decodeLeaderboardCursor(encoded, 1_999), payload);
  assert.throws(
    () => decodeLeaderboardCursor(encodeLeaderboardCursor({ ...payload, score: "9".repeat(400) }), 1),
    (error: unknown) => error instanceof LeaderboardError && error.code === "LEADERBOARD_CURSOR_INVALID",
  );
  assert.throws(
    () => decodeLeaderboardCursor(`${encoded}=`, 1),
    (error: unknown) => error instanceof LeaderboardError && error.code === "LEADERBOARD_CURSOR_INVALID",
  );
  assert.throws(
    () => decodeLeaderboardCursor(encodeLeaderboardCursor(payload), 2_000),
    (error: unknown) => error instanceof LeaderboardError && error.code === "LEADERBOARD_CURSOR_EXPIRED",
  );
});

test("synthetic 1,000-user competition-rank reference stays deterministic", (t) => {
  const ledgerRows = Array.from({ length: 20_000 }, (_, index) => {
    const userIndex = Math.floor(index / 20);
    return {
      userId: `user-${String(userIndex).padStart(4, "0")}`,
      amount: BigInt((userIndex % 10) + 1),
    };
  });
  const start = performance.now();
  const totals = new Map<string, bigint>();
  for (const row of ledgerRows) {
    totals.set(row.userId, (totals.get(row.userId) ?? 0n) + row.amount);
  }
  const users = [...totals].map(([userId, score]) => ({ userId, score }));
  users.sort((left, right) =>
    left.score === right.score
      ? left.userId.localeCompare(right.userId)
      : left.score > right.score ? -1 : 1);
  const ranks: number[] = [];
  for (let index = 0; index < users.length; index += 1) {
    const user = users[index]!;
    ranks.push(
      index === 0 || user.score !== users[index - 1]!.score
        ? index + 1
        : ranks[index - 1]!,
    );
  }
  const elapsedMs = performance.now() - start;
  assert.equal(users.length, 1_000);
  assert.equal(ledgerRows.length, 20_000);
  assert.ok(ranks.slice(0, 100).every((rank) => rank === 1));
  assert.equal(ranks[100], 101);
  t.diagnostic(
    `Reference aggregation/ranking of 20,000 synthetic ledger rows for 1,000 users: ${elapsedMs.toFixed(2)} ms.`,
  );
});

type TestServer = { baseUrl: string; close(): Promise<void> };

async function listen(app: express.Express): Promise<TestServer> {
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())),
  };
}

test("leaderboard user routes require authentication and validate limits before data reads", async () => {
  let databaseCalls = 0;
  const database = {
    async $transaction() {
      databaseCalls += 1;
      throw new Error("The invalid request must not reach the database.");
    },
  } as unknown as PrismaClient;
  const requireUser: RequestHandler = (req, res, next) => {
    if (req.header("x-test-user") !== "user-1") {
      return res.status(401).json({ error: "Authentication required." });
    }
    (req as express.Request & { user?: { id: string } }).user = { id: "user-1" };
    next();
  };
  const app = express();
  app.use("/api", createLeaderboardRouter({ requireUser, database }));
  const server = await listen(app);
  try {
    assert.equal(
      (await fetch(`${server.baseUrl}/api/leaderboards/availability`)).status,
      401,
    );
    assert.equal((await fetch(`${server.baseUrl}/api/leaderboards/WEEKLY`)).status, 401);
    const availability = await fetch(
      `${server.baseUrl}/api/leaderboards/availability`,
      { headers: { "x-test-user": "user-1" } },
    );
    assert.equal(availability.status, 200);
    assert.equal(
      availability.headers.get("cache-control"),
      "private, no-store",
    );
    const availabilityBody = await availability.json() as { scopes: string[] };
    assert.deepEqual(
      availabilityBody.scopes.filter((scope) => scope !== "SEMESTER"),
      ["WEEKLY", "MONTHLY", "ALL_TIME"],
    );
    assert.ok(
      availabilityBody.scopes.length === 3
      || availabilityBody.scopes.length === 4,
    );
    assert.equal(databaseCalls, 0);
    const invalid = await fetch(
      `${server.baseUrl}/api/leaderboards/WEEKLY?limit=101`,
      { headers: { "x-test-user": "user-1" } },
    );
    assert.equal(invalid.status, 400);
    assert.equal(databaseCalls, 0);
  } finally {
    await server.close();
  }
});

test("admin leaderboard routes deny students and hosts and reject user-supplied ranking values", async () => {
  let readCalls = 0;
  const writeCalls = 0;
  const database = {
    async $transaction(run: (transaction: unknown) => Promise<unknown>) {
      readCalls += 1;
      return run({
        leaderboardSeason: {
          async findUnique() { return null; },
        },
      });
    },
  } as unknown as PrismaClient;
  const requireAdmin: RequestHandler = (req, res, next) => {
    const role = req.header("x-test-role");
    if (!role) return res.status(401).json({ error: "Authentication required." });
    if (role !== "admin" && role !== "owner") {
      return res.status(403).json({ error: "Administrative role required." });
    }
    next();
  };
  const app = express();
  app.use(express.json());
  app.use(
    "/api/admin/leaderboards",
    createAdminLeaderboardRouter({ requireAdmin, database }),
  );
  const server = await listen(app);
  try {
    const rebuild = `${server.baseUrl}/api/admin/leaderboards/seasons/season-1/rebuild`;
    for (const role of ["student", "group-host"]) {
      const denied = await fetch(rebuild, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-role": role },
        body: "{}",
      });
      assert.equal(denied.status, 403);
    }
    const injectedScore = await fetch(rebuild, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-role": "admin" },
      body: JSON.stringify({ score: 999, rank: 1, winner: "user-1" }),
    });
    assert.equal(injectedScore.status, 400);
    assert.equal(readCalls, 0);
    assert.equal(writeCalls, 0);

    const dryRun = await fetch(
      `${server.baseUrl}/api/admin/leaderboards/seasons/season-1/reconciliation`,
      { headers: { "x-test-role": "owner" } },
    );
    assert.equal(dryRun.status, 404);
    assert.equal(readCalls, 1);
    assert.equal(writeCalls, 0);
  } finally {
    await server.close();
  }
});

test("D1 read failure falls back to PostgreSQL with semester ties and a next page", async () => {
  const now = new Date("2026-10-09T12:00:00.000Z");
  const season = {
    id: "fall-2026-season",
    scope: "SEMESTER",
    seasonKey: "semester:fall-2026",
    startsAt: new Date("2026-08-31T21:00:00.000Z"),
    endsAt: new Date("2027-01-31T21:00:00.000Z"),
    status: "ACTIVE",
  };
  const snapshot = {
    id: "fall-2026-live-snapshot",
    seasonId: season.id,
    snapshotType: "LIVE",
    status: "READY",
    revision: 1,
    generatedAt: now,
    scoreThrough: now,
    entryCount: 4,
    sourceFingerprint: "a".repeat(64),
    rankingSemanticsVersion: "leaderboard-ranking-v1",
  };
  const rows = [
    { userId: "user-a", rank: 1, tieSize: 1, score: 100n, levelSnapshot: 8 },
    { userId: "user-b", rank: 2, tieSize: 2, score: 80n, levelSnapshot: 7 },
    { userId: "user-c", rank: 2, tieSize: 2, score: 80n, levelSnapshot: 6 },
    { userId: "user-d", rank: 4, tieSize: 1, score: 60n, levelSnapshot: 5 },
  ];
  const database = {
    async $transaction(run: (tx: unknown) => Promise<unknown>) {
      return run({
        async $executeRaw() { return 1; },
        leaderboardSeason: {
          async findUniqueOrThrow() { return season; },
        },
      });
    },
    leaderboardSnapshot: {
      async findFirst() { return snapshot; },
    },
    leaderboardSnapshotEntry: {
      async findMany(input: { take: number }) {
        return rows.slice(0, input.take);
      },
      async count() { return rows.length; },
    },
    userBlock: {
      async findMany() { return []; },
    },
  } as unknown as PrismaClient;

  const originalFetch = globalThis.fetch;
  process.env.LEADERBOARD_D1_READ_ENABLED = "true";
  process.env.LEADERBOARD_D1_WORKER_URL = "https://leaderboard-cache.invalid";
  process.env.LEADERBOARD_D1_SYNC_SECRET = "leaderboard-test-secret";
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: "test cache unavailable" }),
    { status: 503, headers: { "content-type": "application/json" } },
  );
  try {
    const result = await getLeaderboardPageWithCache({
      viewerId: "viewer-1",
      scope: "SEMESTER",
      limit: 2,
      now,
      database,
    });
    assert.equal(result.season.seasonKey, "semester:fall-2026");
    assert.deepEqual(
      result.entries.map(({ rank, tieSize, score }) => [rank, tieSize, score]),
      [[1, 1, 100], [2, 2, 80]],
    );
    assert.equal(result.totalRankedUsers, 4);
    assert.ok(result.nextCursor);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.LEADERBOARD_D1_READ_ENABLED;
    delete process.env.LEADERBOARD_D1_WORKER_URL;
    delete process.env.LEADERBOARD_D1_SYNC_SECRET;
  }
});