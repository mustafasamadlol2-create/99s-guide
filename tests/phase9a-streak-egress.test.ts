import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import {
  createStudyStreakService,
  type StudyStreakDatabase,
} from "../server/features/study-streak/service.js";
import { createStudyStreakRouter } from "../server/routes/studyStreak.js";
import {
  acceptGamificationUpdate,
  invalidateStudyStreak,
  readGamificationResource,
  setGamificationReadAccountScope,
} from "../src/features/gamification/realtime.ts";

const now = new Date("2026-01-01T21:00:00.000Z");

test("streak combines bounded daily evidence without changing calendar or counters", async () => {
  const queries: Array<{ sql: string; bindings: unknown[] }> = [];
  const database: StudyStreakDatabase = {
    studyDailyMetric: {
      async findMany(args) {
        assert.deepEqual(args, {
          where: {
            userId: "study-user",
            metricDate: { gte: new Date("2025-01-03"), lte: new Date("2026-01-02") },
          },
          select: {
            metricDate: true, focusSeconds: true, sessionsCompleted: true, mcqAttempts: true,
            flashcardReviews: true, recallAttempts: true, lectureCompletions: true,
          },
          orderBy: { metricDate: "asc" },
        });
        return [{
          metricDate: new Date("2026-01-01"), focusSeconds: 180, sessionsCompleted: 1,
          mcqAttempts: 8, flashcardReviews: 4, recallAttempts: 2, lectureCompletions: 1,
        }];
      },
    },
    $queryRaw: (async (parts: TemplateStringsArray, ...bindings: unknown[]) => {
      const sql = parts.join("?");
      queries.push({ sql, bindings });
      if (sql.includes('"StudyEvent"')) return [
        { date: "2025-12-30", progressEvents: 0n },
        { date: "2026-01-02", progressEvents: 2n },
      ];
      if (sql.includes('"GroupFocusRun"')) return [{ date: "2026-01-02", verifiedFocusSeconds: 600n }];
      return [{ date: "2026-01-02" }];
    }) as StudyStreakDatabase["$queryRaw"],
  };
  const summary = await createStudyStreakService({ database, now: () => now }).getSummary("study-user");
  assert.equal(summary.days.length, 365);
  assert.equal(summary.rangeEnd, "2026-01-02");
  assert.equal(summary.currentStreakDays, 2);
  assert.equal(summary.longestStreakDays, 2);
  assert.equal(summary.activeDaysInRange, 3);
  assert.deepEqual(summary.days.slice(-4).map(({ date, active }) => ({ date, active })), [
    { date: "2025-12-30", active: true },
    { date: "2025-12-31", active: false },
    { date: "2026-01-01", active: true },
    { date: "2026-01-02", active: true },
  ]);
  assert.equal(summary.days.at(-2)?.mcqAttempts, 8);
  assert.equal(summary.days.at(-2)?.flashcardReviews, 4);
  assert.equal(summary.days.at(-2)?.focusSeconds, 180);
  assert.equal(summary.days.at(-1)?.groupFocusSeconds, 600);
  assert.equal(summary.days.at(-1)?.progressEvents, 2);
  assert.equal(queries.length, 3);
  for (const { sql, bindings } of queries) {
    assert.doesNotMatch(sql, /study-user/);
    assert.deepEqual(bindings.slice(0, 2), ["Asia/Baghdad", "study-user"]);
    assert.deepEqual(bindings.slice(-2).map((binding) => (binding as { values: unknown[] }).values[0]), [
      new Date("2025-01-02T21:00:00.000Z"),
      now,
    ]);
  }
});

test("empty history and unavailable projections preserve canonical fallback", async () => {
  let failReads = false;
  const empty = async () => {
    if (failReads) throw new Error("fixture database unavailable");
    return [];
  };
  const database: StudyStreakDatabase = {
    studyDailyMetric: { findMany: empty },
    $queryRaw: (async (parts: TemplateStringsArray) => {
      if (failReads && parts.join("").includes('"StudyPointsLedgerEntry"')) {
        return [{ date: "2026-01-02" }];
      }
      return empty();
    }) as StudyStreakDatabase["$queryRaw"],
  };
  const service = createStudyStreakService({ database, now: () => now });
  const noActivity = await service.getSummary("study-user");
  assert.equal(noActivity.activeToday, false);
  assert.equal(noActivity.currentStreakDays, 0);
  assert.equal(noActivity.longestStreakDays, 0);
  assert.ok(noActivity.days.every((day) => !day.active && day.intensity === 0));

  failReads = true;
  const fallback = await service.getSummary("study-user");
  assert.equal(fallback.activeToday, true);
  assert.equal(fallback.currentStreakDays, 1);
  database.$queryRaw = empty as StudyStreakDatabase["$queryRaw"];
  await assert.rejects(service.getSummary("study-user"), /All study streak activity sources/);
});

test("the streak route reads only the authenticated account and preserves its private response contract", async () => {
  const reads: string[] = [];
  const database: StudyStreakDatabase = {
    studyDailyMetric: { async findMany() { return []; } },
    $queryRaw: (async () => []) as StudyStreakDatabase["$queryRaw"],
  };
  const service = createStudyStreakService({ database, now: () => now });
  const app = express();
  app.use("/api", createStudyStreakRouter({
    requireUser: (req, res, next) => {
      if (req.get("authorization") !== "Bearer local-streak-fixture") {
        res.sendStatus(401);
        return;
      }
      Object.assign(req, { user: { id: "authenticated-fixture" } });
      next();
    },
    getSummary: (userId) => {
      reads.push(userId);
      if (reads.length > 1) throw new Error("fixture unavailable");
      return service.getSummary(userId);
    },
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + (server.address() as AddressInfo).port + "/api/me/study-streak?userId=another-account";
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.deepEqual(reads, []);
    const init = { headers: { authorization: "Bearer local-streak-fixture" } };
    const response = await fetch(url, init);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, private, max-age=0");
    assert.equal((await response.json()).historyDays, 365);
    assert.deepEqual(reads, ["authenticated-fixture"]);
    const unavailable = await fetch(url, init);
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get("cache-control"), "no-store, private, max-age=0");
    assert.equal((await unavailable.json()).code, "STUDY_STREAK_UNAVAILABLE");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("shell, profile and overview reuse one private read until that user's activity or reconnection", async () => {
  const accountId = "phase9a-shared";
  setGamificationReadAccountScope(accountId);
  let requests = 0;
  const read = (date = "2026-01-01") => readGamificationResource("studyStreak", date,
    async () => ++requests, { accountId, cacheTtlMs: 15_000 });
  try {
    assert.deepEqual(await Promise.all([read(), read(), read()]), [1, 1, 1]);
    acceptGamificationUpdate({ resources: ["rank", "leaderboard"] });
    assert.equal(await read(), 1);
    acceptGamificationUpdate({ resources: ["summary"] });
    assert.equal(await read(), 2);
    invalidateStudyStreak(accountId);
    assert.deepEqual(await Promise.all([read(), read()]), [3, 3]);
    assert.equal(await read("2026-01-02"), 4);
  } finally {
    setGamificationReadAccountScope(null);
  }
});

test("in-flight activity reads cannot survive a canonical change or cross an account switch", async () => {
  let resolveOld!: (value: string) => void;
  const old = new Promise<string>((resolve) => { resolveOld = resolve; });
  const accountId = "phase9a-inflight";
  let loads = 0;
  let isCurrent = true;
  const options = { accountId, isCurrent: () => isCurrent, cacheTtlMs: 15_000 };
  const load = async () => ++loads === 1 ? old : "verified";
  const original = readGamificationResource("studyStreak", "session-a", load, options);
  await Promise.resolve();
  invalidateStudyStreak(accountId);
  const fresh = readGamificationResource("studyStreak", "session-a", load, options);
  resolveOld("superseded");
  assert.deepEqual(await Promise.all([original, fresh]), ["verified", "verified"]);
  assert.equal(loads, 2);

  const switching = readGamificationResource("studyStreak", "session-b", async () => "private", options);
  await Promise.resolve();
  isCurrent = false;
  await assert.rejects(switching, { name: "AbortError" });
  assert.equal(await readGamificationResource("studyStreak", "session-b", async () => "new account", {
    accountId: "phase9a-second-account",
  }), "new account");
});
