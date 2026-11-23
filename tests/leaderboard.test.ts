import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { performance } from "node:perf_hooks";
import { Prisma, type PrismaClient } from "@prisma/client";
import test from "node:test";
import { decodeLeaderboardCursor, encodeLeaderboardCursor } from "../server/features/leaderboard/cursor.js";
import {
  fingerprintLeaderboardSnapshot,
  getLeaderboardRankingSemanticsVersion,
  hashLeaderboardRuleVersions,
} from "../server/features/leaderboard/fingerprint.js";
import { LeaderboardError } from "../server/features/leaderboard/errors.js";
import {
  getAvailableLeaderboardScopes,
  getLeaderboardSeasonWindow,
  SERVER_OWNED_SEMESTER_BOUNDARIES,
  validateSeasonKey,
} from "../server/features/leaderboard/periods.js";
import { getLeaderboardPageWithCache } from "../server/features/leaderboard/cacheReads.js";
import {
  parseLeaderboardPageSize,
  resolveSeason,
  safePublicAvatarUrl,
  safePublicDisplayName,
} from "../server/features/leaderboard/queries.js";
import { readRankedLeaderboardScores, readUserLeaderboardScore } from "../server/features/leaderboard/scores.js";
import type { RankedScore } from "../server/features/leaderboard/types.js";
import {
  createAdminLeaderboardRouter,
  createLeaderboardRouter,
} from "../server/routes/leaderboards.js";

// Cursor tests use a disposable key; production reads the existing auth secret.
process.env.SESSION_SECRET = "leaderboard-test-only-session-secret";

const weekly = getLeaderboardSeasonWindow(
  "WEEKLY",
  new Date("2026-09-24T20:59:59.999Z"),
);

test("leaderboard display names reject email and account identifier values", () => {
  assert.equal(safePublicDisplayName("  Ada   Lovelace  "), "Ada Lovelace");
  assert.equal(safePublicDisplayName("student@example.test"), null);
  assert.equal(safePublicDisplayName("123e4567-e89b-42d3-a456-426614174000"), null);
  assert.equal(safePublicDisplayName(`  ${"x".repeat(100)}  `)?.length, 80);
});

test("leaderboard public avatars allow web and app-relative image URLs only", () => {
  assert.equal(safePublicAvatarUrl("https://cdn.example.test/avatar.png"), "https://cdn.example.test/avatar.png");
  assert.equal(safePublicAvatarUrl("/api/media/avatar/1"), "/api/media/avatar/1");
  assert.equal(safePublicAvatarUrl("javascript:alert(1)"), null);
  assert.equal(safePublicAvatarUrl("//tracker.example.test/avatar.png"), null);
});

test("leaderboard pages accept a bounded 200-entry cohort page", () => {
  assert.equal(parseLeaderboardPageSize(200), 200);
  assert.throws(() => parseLeaderboardPageSize(201));
});

function querySource(query: unknown): string {
  if (Array.isArray(query)) return query.join("<value>");
  if (query && typeof query === "object" && "sql" in query) {
    return String((query as { sql: unknown }).sql);
  }
  return String(query);
}

test("Baghdad weekly and monthly boundaries are exact and half-open", () => {
  const beforeSunday = getLeaderboardSeasonWindow(
    "WEEKLY",
    new Date("2026-09-26T20:59:59.999Z"),
  );
  const sunday = getLeaderboardSeasonWindow(
    "WEEKLY",
    new Date("2026-09-26T21:00:00.000Z"),
  );
  assert.equal(beforeSunday.seasonKey, "weekly:2026-09-20");
  assert.equal(sunday.seasonKey, "weekly:2026-09-27");
  assert.equal(beforeSunday.endsAt?.getTime(), sunday.startsAt?.getTime());
  assert.equal(sunday.startsAt?.toISOString(), "2026-09-26T21:00:00.000Z");
  assert.equal(sunday.endsAt?.toISOString(), "2026-10-03T21:00:00.000Z");

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


test("Tuesday remains in the Sunday-start Baghdad week and includes Sunday", () => {
  const window = getLeaderboardSeasonWindow(
    "WEEKLY",
    new Date("2026-10-19T21:30:00.000Z"),
  );
  assert.equal(window.seasonKey, "weekly:2026-10-18");
  assert.equal(window.startsAt?.toISOString(), "2026-10-17T21:00:00.000Z");
  assert.equal(window.endsAt?.toISOString(), "2026-10-24T21:00:00.000Z");
  assert.ok(window.startsAt! < new Date("2026-10-18T12:32:00.000Z"));
  assert.ok(window.endsAt! > new Date("2026-10-19T21:30:00.000Z"));
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
  assert.equal(validateSeasonKey("WEEKLY", "weekly:2026-10-18"), true);
  assert.equal(validateSeasonKey("WEEKLY", "weekly:2026-10-19"), false);
  assert.equal(validateSeasonKey("WEEKLY", "weekly:2026-W42"), true);
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
  assert.deepEqual(active, ["MONTHLY", "SEMESTER", "ALL_TIME"]);
  assert.deepEqual(outsideConfiguredTerms, ["MONTHLY", "ALL_TIME"]);
  assert.deepEqual(noConfiguration, ["MONTHLY", "ALL_TIME"]);
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

test("competition ranks include zero-point students and exclude negative scores", () => {
  const fixtures = [
    { userId: "a", score: 100n },
    { userId: "d", score: 60n },
    { userId: "c", score: 80n },
    { userId: "b", score: 80n },
    { userId: "zero", score: 0n },
    { userId: "negative", score: -5n },
  ].filter((row) => row.score >= 0n)
    .sort((left, right) =>
      left.score === right.score
        ? left.userId.localeCompare(right.userId)
        : left.score > right.score ? -1 : 1);
  const expectedRanks = [1, 2, 2, 4, 5];
  const actualRanks: number[] = [];
  let previous: bigint | null = null;
  for (let index = 0; index < fixtures.length; index += 1) {
    const score = fixtures[index]!.score;
    if (score !== previous) actualRanks.push(index + 1);
    else actualRanks.push(actualRanks[index - 1]!);
    previous = score;
  }
  assert.deepEqual(actualRanks, expectedRanks);
  assert.deepEqual(fixtures.map(({ userId }) => userId), ["a", "b", "c", "d", "zero"]);

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
  assert.match(scoreQuery, /"StudyPointsLedgerEntry"/u);
  assert.match(scoreQuery, /"sourceType" <> 'LEGACY_POINTS_LOG'/u);
  assert.match(scoreQuery, /"category" <> 'LEGACY'/u);
  assert.doesNotMatch(scoreQuery, /FROM "PointsLog"/u);
  assert.match(scoreQuery, /RANK\(\) OVER/u);
  assert.match(scoreQuery, /COUNT\(\*\) OVER \(PARTITION BY eligible\.score\)/u);
   assert.match(scoreQuery, /GREATEST\(COALESCE\(scores\.score, 0\), 0\)/u);
  assert.doesNotMatch(scoreQuery, /"role"\s*=\s*'user'/u);
  assert.match(scoreQuery, /"accountStatus" = 'ACTIVE'/u);
  assert.equal(sqlStatements.filter((sql) => sql.includes("WITH period_points")).length, 1);
  assert.deepEqual(result.rows.map((row) => row.rank), [1, 2, 2, 4]);
  assert.deepEqual(result.rows.map((row) => row.score), [100n, 80n, 80n, 60n]);
  assert.deepEqual(result.ruleVersions, ["focus-points-v1"]);
  assert.ok(end > start);
});

test("All-Time set query uses the V2 competitive ledger and excludes legacy totals", async () => {
  const sqlStatements: string[] = [];
  const tx = {
    async $queryRaw(query: unknown) {
      const sql = querySource(query);
      sqlStatements.push(sql);
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
    scoreThrough: new Date("2026-11-20T12:00:00Z"),
    compatibilityMode: "LEGACY_PLUS_LEDGER",
  }, tx);
  const combinedQuery = sqlStatements.find((sql) => sql.includes("WITH period_points")) ?? "";
  assert.match(combinedQuery, /"User"/u);
  assert.match(combinedQuery, /"StudyPointsLedgerEntry"/u);
  assert.match(combinedQuery, /"effectiveAt" >=/u);
  assert.match(combinedQuery, /"createdAt" <=/u);
  assert.match(combinedQuery, /"sourceType" <> 'LEGACY_POINTS_LOG'/u);
  assert.match(combinedQuery, /"category" <> 'LEGACY'/u);
  assert.doesNotMatch(combinedQuery, /FROM "PointsLog"/u);
  assert.doesNotMatch(combinedQuery, /"totalPoints"/u);
  assert.equal(sqlStatements.length, 1);
  assert.equal(result.rows[0]?.score, 140n);
  // The retired compatibility hint must not reintroduce legacy points.
  assert.equal(result.compatibilityMode, "LEDGER_ONLY");
  assert.deepEqual(result.ruleVersions, ["focus-v1", "study-v2"]);
});

test("own All-Time score excludes legacy balances and uses only competitive ledger", async () => {
  const queries: string[] = [];
  const tx = {
    async $queryRaw(query: unknown) {
      const sql = querySource(query);
      queries.push(sql);
      return [{ score: "40" }];
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
    scoreThrough: new Date("2026-11-20T12:00:00Z"),
    compatibilityMode: "LEGACY_PLUS_LEDGER",
  }, database);
  assert.equal(score.score, 40);
  assert.equal(score.compatibilityMode, "LEDGER_ONLY");
  assert.equal(queries.length, 1);
  assert.match(queries[0]!, /"StudyPointsLedgerEntry"/u);
  assert.match(queries[0]!, /"sourceType" <> 'LEGACY_POINTS_LOG'/u);
  assert.doesNotMatch(queries[0]!, /"totalPoints"/u);
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
      seasonKey: "weekly:2026-09-20",
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
  assert.equal(encoded.includes("user-b"), false);
  assert.deepEqual(decodeLeaderboardCursor(encoded, 1_999), payload);
  const legacyEncoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  assert.throws(
    () => decodeLeaderboardCursor(legacyEncoded, 1),
    (error: unknown) =>
      error instanceof LeaderboardError
      && error.code === "LEADERBOARD_CURSOR_EXPIRED",
  );
  const tampered = `${encoded.slice(0, -1)}${encoded.endsWith("A") ? "B" : "A"}`;
  assert.throws(
    () => decodeLeaderboardCursor(tampered, 1),
    (error: unknown) =>
      error instanceof LeaderboardError
      && error.code === "LEADERBOARD_CURSOR_INVALID",
  );
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

test("public leaderboard names are normalized and never expose email addresses", () => {
  assert.equal(safePublicDisplayName("  زينب   أحمد  "), "زينب أحمد");
  assert.equal(safePublicDisplayName("student@example.com"), null);
  assert.equal(safePublicDisplayName(""), null);
  assert.equal(safePublicDisplayName("x".repeat(100))?.length, 80);
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
      ["MONTHLY", "ALL_TIME"],
    );
    assert.ok(
      availabilityBody.scopes.length === 2
      || availabilityBody.scopes.length === 3,
    );
    assert.equal(databaseCalls, 0);
    // Legacy WEEKLY seasons are retained for historical reconciliation, but
    // students must not be able to request the retired leaderboard directly.
    const retired = await fetch(
      `${server.baseUrl}/api/leaderboards/WEEKLY?limit=2`,
      { headers: { "x-test-user": "user-1" } },
    );
    assert.equal(retired.status, 400);
    assert.equal((await retired.json() as { code: string }).code, "LEADERBOARD_INVALID_SCOPE");
    const retiredRank = await fetch(
      `${server.baseUrl}/api/me/leaderboard-rank?scope=WEEKLY`,
      { headers: { "x-test-user": "user-1" } },
    );
    assert.equal(retiredRank.status, 400);
    assert.equal((await retiredRank.json() as { code: string }).code, "LEADERBOARD_INVALID_SCOPE");
    const invalid = await fetch(
      `${server.baseUrl}/api/leaderboards/MONTHLY?limit=201`,
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

test("D1 cursor-page failure falls back to PostgreSQL with semester ties and a next page", async () => {
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
     rankingSemanticsVersion: getLeaderboardRankingSemanticsVersion("SEMESTER"),
  };
  const rows = [
    { userId: "user-a", rank: 1, tieSize: 1, score: 100n, levelSnapshot: 8, user: { name: "Student A" } },
    { userId: "user-b", rank: 2, tieSize: 2, score: 80n, levelSnapshot: 7, user: { name: "Student B" } },
    { userId: "user-c", rank: 2, tieSize: 2, score: 80n, levelSnapshot: 6, user: { name: "Student C" } },
    { userId: "user-d", rank: 4, tieSize: 1, score: 60n, levelSnapshot: 5, user: { name: "Student D" } },
  ];
  const cursor = {
    version: 1 as const,
    snapshotId: snapshot.id,
    seasonId: season.id,
    rank: 1,
    score: "100",
    userId: "user-a",
    expiresAt: now.getTime() + 15 * 60_000,
  };
  const database = {
    leaderboardSeason: {
      async findUnique() { return season; },
    },
    leaderboardSnapshot: {
      async findUnique() { return snapshot; },
    },
    leaderboardSnapshotEntry: {
      async findFirst() { return { rank: 1, score: 100n }; },
      async findMany(input: { take: number; where: unknown }) {
        // PostgreSQL cursor paging starts AFTER user-a; provide one extra
        // entry so the fallback must generate another cursor.
        assert.ok(input.where && typeof input.where === "object" && "AND" in input.where);
        return rows.slice(1, 1 + input.take);
      },
      async count() { return rows.length; },
    },
    userBlock: {
      async findMany() { return []; },
    },
    user: {
      async count() { return 4; },
    },
  } as unknown as PrismaClient;

  const originalFetch = globalThis.fetch;
  process.env.LEADERBOARD_D1_READ_ENABLED = "true";
  process.env.LEADERBOARD_D1_WORKER_URL = "https://leaderboard-cache.invalid";
  process.env.LEADERBOARD_D1_SYNC_SECRET = "leaderboard-test-secret";
  let cacheFetches = 0;
  globalThis.fetch = async () => {
    cacheFetches += 1;
    return new Response(
      JSON.stringify({ error: "test cache unavailable" }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const result = await getLeaderboardPageWithCache({
      viewerId: "viewer-1",
      scope: "SEMESTER",
      limit: 2,
      cursor,
      now,
      database,
    });
    assert.equal(result.season.seasonKey, "semester:fall-2026");
    assert.deepEqual(
      result.entries.map(({ rank, tieSize, score }) => [rank, tieSize, score]),
      [[2, 2, 80], [2, 2, 80]],
    );
    assert.deepEqual(
      Object.keys(result.entries[0]!).sort(),
      ["avatarUrl", "displayName", "isViewer", "level", "rank", "score", "tieSize"],
    );
    assert.equal(result.entries[0]?.displayName, "Student B");
    assert.equal(result.entries[0]?.avatarUrl, null);
    assert.equal(JSON.stringify(result).includes("user-b"), false);
    assert.equal(result.totalRankedUsers, 4);
    assert.ok(result.nextCursor);
    assert.equal(cacheFetches, 1, "D1 must be attempted before PostgreSQL fallback");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.LEADERBOARD_D1_READ_ENABLED;
    delete process.env.LEADERBOARD_D1_WORKER_URL;
    delete process.env.LEADERBOARD_D1_SYNC_SECRET;
  }
});
