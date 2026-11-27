import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { getBaghdadWeekPeriod } from "../server/features/gamification/challengePeriods.js";
import { readActiveChallengeReconciliationWindow } from "../server/features/gamification/challengeReconciliation.js";
import { getMyChallenges, type RefreshedUserChallenges } from "../server/features/gamification/challengeRefresh.js";
import { createGamificationPostCommitScheduler } from "../server/features/gamification/postCommitRefresh.js";
import {
  acknowledgePrivateD1SyncOutboxRow,
  enqueuePrivateD1Projection,
  leasePrivateD1SyncOutboxBatch,
  markPrivateD1SyncOutboxRowFailure,
  postPrivateD1SyncMutation,
} from "../server/services/privateD1Sync.js";

test("same-account notifications share a refresh while activity committed in flight gets another pass", async () => {
  type Request = Parameters<ReturnType<typeof createGamificationPostCommitScheduler>>[0];
  const seen: Request[] = [];
  let finishFirst!: () => void;
  const first = new Promise<void>((resolve) => { finishFirst = resolve; });
  const schedule = createGamificationPostCommitScheduler(async (request) => {
    seen.push(request);
    if (request.userId === "a" && seen.filter((row) => row.userId === "a").length === 1) await first;
  }, () => assert.fail("unexpected refresh failure"));

  schedule({ userId: "a", full: true, metricIds: [], resources: ["summary", "rank"] });
  schedule({ userId: "a", full: false, metricIds: ["focus"], resources: ["challenges"] });
  schedule({ userId: "b", full: false, metricIds: ["lecture"], resources: ["challenges"] });
  await nextTurn();
  assert.deepEqual(seen, [
    { userId: "a", full: true, metricIds: ["focus"], resources: ["summary", "rank", "challenges"] },
    { userId: "b", full: false, metricIds: ["lecture"], resources: ["challenges"] },
  ]);

  schedule({ userId: "a", full: false, metricIds: ["mcq"], resources: ["challenges"] });
  schedule({ userId: "a", full: false, metricIds: ["mcq", "flashcard"], resources: ["challenges"] });
  await nextTurn();
  assert.equal(seen.length, 2);
  finishFirst();
  await nextTurn();
  await nextTurn();
  assert.deepEqual(seen[2], {
    userId: "a", full: false, metricIds: ["mcq", "flashcard"], resources: ["challenges"],
  });
});

test("a failed refresh and failed logging leave queued work runnable", async () => {
  let runs = 0;
  let logged = 0;
  let finishFirst!: () => void;
  const first = new Promise<void>((resolve) => { finishFirst = resolve; });
  const schedule = createGamificationPostCommitScheduler(async () => {
    runs++;
    if (runs === 1) {
      await first;
      throw new Error("synthetic database unavailable");
    }
  }, () => {
    logged++;
    throw new Error("synthetic telemetry failure");
  });
  const request = { userId: "a", full: true, metricIds: [], resources: ["summary"] as const };
  schedule(request);
  await nextTurn();
  schedule(request);
  finishFirst();
  await nextTurn();
  await nextTurn();
  assert.equal(logged, 1);
  assert.equal(runs, 2);
});

test("snapshot construction can consume only the current account and current Baghdad period evaluation", async () => {
  const period = getBaghdadWeekPeriod(new Date());
  const completed: RefreshedUserChallenges = {
    userId: "a", period, ruleSetVersion: "test", instances: [], progress: [], rewardPointsAwarded: 0,
  };
  let canonicalRefreshes = 0;
  let historyReads = 0;
  const database = {
    $transaction: async () => {
      canonicalRefreshes++;
      throw new Error("fixture fresh evaluation required");
    },
    userChallengeProgress: { findMany: async ({ where }: { where: { userId: string } }) => {
      assert.equal(where.userId, "a");
      historyReads++;
      return [];
    } },
  } as unknown as PrismaClient;
  assert.deepEqual(await getMyChallenges("a", database, completed), {
    ruleSetVersion: "test", currentPeriod: period, active: [], recent: [],
  });
  assert.equal(historyReads, 2);
  assert.equal(canonicalRefreshes, 0);
  await assert.rejects(getMyChallenges("b", database, completed), /fresh evaluation required/);
  await assert.rejects(getMyChallenges("a", database, {
    ...completed, period: getBaghdadWeekPeriod(new Date(period.startsAt.getTime() - 1)),
  }), /fresh evaluation required/);
  assert.equal(canonicalRefreshes, 2);
  assert.equal(historyReads, 2);
});

const fixturePath = process.env.PHASE9B_LOCAL_FIXTURE_DIRECTORY;

test("disposable PostgreSQL verifies pending equivalence, tombstones, leases and delivery bytes", {
  skip: fixturePath ? false : "Requires the explicitly selected disposable loopback PostgreSQL fixture.",
}, async () => {
  const db = new PrismaClient({
    datasourceUrl: "postgresql://phase9_test@127.0.0.1:56793/postgres?schema=public",
  });
  const expected = realpathSync(fixturePath!);
  const rollback = new Error("rollback fixture");
  try {
    const [identity] = await db.$queryRaw<Array<{ directory: string; role: string; ip: string; port: number }>>`
      SELECT current_setting('data_directory') AS "directory", current_user AS "role",
             inet_server_addr()::text AS "ip", inet_server_port() AS "port"
    `;
    assert.equal(realpathSync(identity.directory), expected);
    assert.equal(identity.role, "phase9_test");
    assert.match(identity.ip, /^127\.0\.0\.1(?:\/32)?$/);
    assert.equal(identity.port, 56793);
    const [existing] = await db.$queryRaw<Array<{ exists: boolean }>>`
      SELECT to_regclass('public."PrivateD1SyncOutbox"') IS NOT NULL AS "exists"
    `;
    assert.equal(existing.exists, false);

    await assert.rejects(db.$transaction(async (tx) => {
      await tx.$executeRaw`
        CREATE TABLE "PrivateD1SyncOutbox" (
          "id" bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          "entity" varchar(100) NOT NULL, "operation" varchar(16) NOT NULL,
          "key" jsonb NOT NULL, "revision" bigint NOT NULL, "data" jsonb,
          "attempts" integer NOT NULL DEFAULT 0, "state" varchar(16) NOT NULL DEFAULT 'PENDING',
          "failureClass" varchar(32), "failureCode" varchar(64), "lastError" varchar(500),
          "nextAttemptAt" timestamp(3) NOT NULL DEFAULT now(), "firstAttemptAt" timestamp(3),
          "lastAttemptAt" timestamp(3), "leaseUntil" timestamp(3), "terminalAt" timestamp(3),
          "updatedAt" timestamp(3) NOT NULL DEFAULT now()
        )
      `;
      const t1 = "2026-11-23T21:05:00.000Z";
      const t2 = "2026-11-23T21:06:00.000Z";
      const end = "2026-11-29T21:00:00.000Z";
      const makeData = (id: string, timestamp: string, changes: {
        points?: number; level?: number; unlockedAt?: string; progress?: number; end?: string; deletedAt?: string;
        history?: boolean;
      } = {}) => ({
        id, userId: id, canonicalId: id, userScope: id, ruleSetVersion: "fixture-rules",
        summaryJson: JSON.stringify({
          ruleSetVersion: "fixture-rules",
          points: { totalPoints: changes.points ?? 10 },
          level: { level: changes.level ?? 1, lastEvaluatedAt: timestamp },
          achievements: [{ achievementId: "first", unlockedAt: changes.unlockedAt ?? null, lastEvaluatedAt: timestamp }],
          unlockHistory: changes.history === false ? [] : [{ testOnlyFixturePadding: "x".repeat(18_900) }],
        }),
        challengesJson: JSON.stringify({ currentPeriod: { endsAt: changes.end ?? end }, active: [
          { challenge: "verified-mcqs", current: changes.progress ?? 1, status: changes.progress === 10 ? "COMPLETED" : "ACTIVE" },
        ] }),
        projectionVersion: 1, revision: "0", challengePeriodEndsAt: changes.end ?? end,
        updatedAt: timestamp, deletedAt: changes.deletedAt ?? null,
      });
      let enqueueCalls = 0;
      let enqueueBytes = 0;
      const counted = {
        $queryRawUnsafe: async <T>(query: string, ...binds: unknown[]): Promise<T> => {
          enqueueCalls++;
          const rows = await tx.$queryRawUnsafe<T>(query, ...binds);
          enqueueBytes += Buffer.byteLength(JSON.stringify(rows));
          return rows;
        },
      };
      const enqueue = (id: string, data = makeData(id, t1), reuseEquivalentPending = true) =>
        enqueuePrivateD1Projection(counted, { entity: "GamificationSnapshot", key: { id }, data, reuseEquivalentPending });

      const legacyA = await enqueue("legacy", makeData("legacy", t1), false);
      const legacyB = await enqueue("legacy", makeData("legacy", t2), false);
      assert.ok(BigInt(legacyB) > BigInt(legacyA));
      const enqueueBaseline = { calls: enqueueCalls, bytes: enqueueBytes };
      enqueueCalls = enqueueBytes = 0;
      const revision = await enqueue("active");
      assert.equal(await enqueue("active", makeData("active", t2)), revision);
      const enqueueOptimized = { calls: enqueueCalls, bytes: enqueueBytes };
      assert.deepEqual(enqueueOptimized, enqueueBaseline);
      await tx.$executeRaw`UPDATE "PrivateD1SyncOutbox" SET "nextAttemptAt" = NOW() - INTERVAL '1 second'`;
      const rows = await leasePrivateD1SyncOutboxBatch(tx);
      const legacy = rows.filter((row) => row.key.id === "legacy");
      const optimized = rows.filter((row) => row.key.id === "active");
      assert.equal(legacy.length, 2);
      assert.equal(optimized.length, 1);
      const resultBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
      assert.ok(resultBytes(optimized) < resultBytes(legacy));

      const wireBodies: string[] = [];
      let respondWithFailure = true;
      const mockWorker = createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        wireBodies.push(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(respondWithFailure ? 503 : 200, { "content-type": "application/json" });
        response.end("{}");
      });
      await new Promise<void>((resolve) => mockWorker.listen(0, "127.0.0.1", resolve));
      const originalBase = process.env.PRIVATE_DATA_WORKER_BASE_URL;
      const originalSecret = process.env.PRIVATE_DATA_SYNC_SECRET;
      process.env.PRIVATE_DATA_WORKER_BASE_URL = "http://127.0.0.1:" + (mockWorker.address() as AddressInfo).port;
      process.env.PRIVATE_DATA_SYNC_SECRET = "fixture-only";
      try {
        const delivery = optimized[0];
        const workerError = await postPrivateD1SyncMutation(delivery).then(
          () => assert.fail("the fixture Worker returned a retryable error"),
          (error: unknown) => error,
        );
        assert.equal(wireBodies.length, 1);
        assert.equal(await markPrivateD1SyncOutboxRowFailure(delivery, workerError, tx), 1);
        assert.equal(await acknowledgePrivateD1SyncOutboxRow(delivery, tx), 0);
        await tx.$executeRaw`UPDATE "PrivateD1SyncOutbox" SET "nextAttemptAt" = NOW() - INTERVAL '1 second' WHERE "id" = ${revision}::bigint`;
        const [retry] = await leasePrivateD1SyncOutboxBatch(tx);
        assert.equal(retry.revision, revision);
        assert.equal(retry.attempts, 2);
        respondWithFailure = false;
        await postPrivateD1SyncMutation(retry);
        assert.equal(await acknowledgePrivateD1SyncOutboxRow(retry, tx), 1);
        assert.equal(await acknowledgePrivateD1SyncOutboxRow(retry, tx), 0);
        assert.deepEqual(JSON.parse(wireBodies[1]).data, JSON.parse(wireBodies[0]).data);
        assert.equal(JSON.parse(wireBodies[1]).revision, revision);
        for (const row of legacy) await postPrivateD1SyncMutation(row);

        console.log("PHASE9B_OUTBOX_FIXTURE", JSON.stringify({
          enqueueBaseline, enqueueOptimized, publications: [legacy.length, optimized.length],
          leasedResultBytes: [resultBytes(legacy), resultBytes(optimized)],
          successfulDeliveryBytes: [wireBodies.slice(2).reduce((bytes, body) => bytes + Buffer.byteLength(body), 0), Buffer.byteLength(wireBodies[1])],
        }));
      } finally {
        if (originalBase === undefined) delete process.env.PRIVATE_DATA_WORKER_BASE_URL;
        else process.env.PRIVATE_DATA_WORKER_BASE_URL = originalBase;
        if (originalSecret === undefined) delete process.env.PRIVATE_DATA_SYNC_SECRET;
        else process.env.PRIVATE_DATA_SYNC_SECRET = originalSecret;
        await new Promise<void>((resolve, reject) => mockWorker.close((error) => error ? reject(error) : resolve()));
      }

      const changes = [
        { points: 11 }, { level: 2 }, { unlockedAt: t1 }, { progress: 5 }, { progress: 10 },
        { end: "2026-12-06T21:00:00.000Z" }, { history: false }, { deletedAt: t2 },
      ];
      for (const [index, change] of changes.entries()) {
        const id = "change-" + index;
        const older = await enqueue(id);
        const newer = await enqueue(id, makeData(id, t2, change));
        assert.ok(BigInt(newer) > BigInt(older));
      }
      const old = await enqueue("tombstone");
      await tx.$executeRaw`
        INSERT INTO "PrivateD1SyncOutbox" ("entity","operation","key","revision")
        VALUES ('GamificationSnapshot','delete','{"id":"tombstone"}',100000)
      `;
      const restored = await enqueue("tombstone", makeData("tombstone", t2));
      assert.ok(BigInt(restored) > BigInt(old));
      assert.notEqual(await enqueue("active", makeData("active", t2)), revision);

      await tx.$executeRaw`CREATE TABLE "User" ("id" text PRIMARY KEY, "accountStatus" text NOT NULL)`;
      await tx.$executeRaw`
        INSERT INTO "User" SELECT 'fixture-user-' || lpad(n::text, 4, '0'),
               CASE WHEN n <= 123 THEN 'ACTIVE' ELSE 'BANNED' END
        FROM generate_series(1, 125) AS n
      `;
      const legacyAccounts = await tx.user.findMany({
        where: { accountStatus: "ACTIVE" }, select: { id: true }, orderBy: { id: "asc" },
      });
      const page = await readActiveChallengeReconciliationWindow(tx, { userId: null, offset: 30, limit: 2 });
      assert.equal(page.total, BigInt(legacyAccounts.length));
      assert.deepEqual(page.ids, legacyAccounts.slice(30, 32).map(({ id }) => id));
      assert.deepEqual(await readActiveChallengeReconciliationWindow(tx, {
        userId: page.ids[0], offset: 0, limit: 2,
      }), { total: 1n, ids: [page.ids[0]] });
      assert.deepEqual(await readActiveChallengeReconciliationWindow(tx, {
        userId: "fixture-user-0124", offset: 0, limit: 2,
      }), { total: 0n, ids: [] });
      assert.deepEqual(await readActiveChallengeReconciliationWindow(tx, {
        userId: null, offset: 123, limit: 2,
      }), { total: 123n, ids: [] });
      console.log("PHASE9B_RECONCILIATION_FIXTURE", JSON.stringify({
        calls: [1, 1], accountIds: [legacyAccounts.length, page.ids.length],
        resultBytes: [resultBytes(legacyAccounts), resultBytes([{ ...page, total: String(page.total) }])],
      }));
      throw rollback;
    }, { timeout: 40_000 }), (error) => error === rollback);
  } finally {
    await db.$disconnect();
  }
});
