import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";
import {
  LEADERBOARD_CACHE_RANKING_VERSION,
  buildLeaderboardCacheManifest,
  requestLeaderboardD1,
  toCacheEntry,
} from "../server/features/leaderboard/cacheProtocol.js";
import { getLeaderboardRankingSemanticsVersion } from "../server/features/leaderboard/fingerprint.js";
import { OutboxDeliveryError, classifyOutboxDeliveryFailure } from "../server/services/outboxDeliveryPolicy.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("Phase 7.2: server cache projection accepts zero and still rejects negative points", () => {
  assert.equal(toCacheEntry({ userId: "zero", rank: 2, tieSize: 4, score: 0n, levelSnapshot: null }).score, 0);
  assert.throws(() => toCacheEntry({ userId: "negative", rank: 2, tieSize: 1, score: -1n, levelSnapshot: null }), /Invalid score/);
  const season = { id: "s", scope: "MONTHLY", seasonKey: "monthly:2026-11", status: "ACTIVE", startsAt: new Date("2026-10-31T21:00:00.000Z"), endsAt: new Date("2026-11-30T21:00:00.000Z") };
  const snapshot = { id: "snap", snapshotType: "LIVE", revision: 1, generatedAt: new Date("2026-11-20T00:00:00.000Z"), scoreThrough: new Date("2026-11-20T00:00:00.000Z"), sourceFingerprint: "a".repeat(64), entryCount: 2, rankingSemanticsVersion: getLeaderboardRankingSemanticsVersion("MONTHLY") };
  const manifest = buildLeaderboardCacheManifest(season, snapshot, [
    { userId: "positive", rank: 1, tieSize: 1, score: 20n, levelSnapshot: null },
    { userId: "zero", rank: 2, tieSize: 1, score: 0n, levelSnapshot: null },
  ]);
  assert.equal(manifest.entryCount, 2);
  assert.equal(manifest.rankingVersion, LEADERBOARD_CACHE_RANKING_VERSION);
});

test("Phase 7.2: Worker accepts the exact server ranking version and zero points", () => {
  const worker = readFileSync(resolve(root, "cloudflare-private-data-api/src/leaderboardCache.ts"), "utf8");
  assert.match(worker, new RegExp(`RANKING = "${LEADERBOARD_CACHE_RANKING_VERSION}"`));
  assert.match(worker, /score: integer\(v\.score, "score", 0, 9007199254740991\)/);
});

test("Phase 7.2: an incomplete COMMIT retries but deterministic 409 conflicts stay permanent", async () => {
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.LEADERBOARD_D1_WORKER_URL;
  const oldSecret = process.env.LEADERBOARD_D1_SYNC_SECRET;
  process.env.LEADERBOARD_D1_WORKER_URL = "https://worker.example.test";
  process.env.LEADERBOARD_D1_SYNC_SECRET = "phase7-test-only-dummy-secret";
  try {
    const calls: Array<[number, string, string]> = [];
    globalThis.fetch = async () => {
      const code = calls.length === 0 ? "CACHE_INCOMPLETE" : "LEADERBOARD_CACHE_DETERMINISTIC_CONFLICT";
      calls.push([409, code, "POST"]);
      return Response.json({ ok: false, code }, { status: 409 });
    };
    await assert.rejects(() => requestLeaderboardD1("/internal/leaderboard-cache/commit", { manifest: {} }), (error: unknown) => {
      assert.ok(error instanceof OutboxDeliveryError);
      assert.equal(error.failureClass, "TRANSIENT");
      assert.equal(error.failureCode, "CACHE_INCOMPLETE");
      assert.equal(classifyOutboxDeliveryFailure(error, 1).state, "RETRY");
      return true;
    });
    await assert.rejects(() => requestLeaderboardD1("/internal/leaderboard-cache/commit", { manifest: {} }), (error: unknown) => {
      assert.ok(error instanceof OutboxDeliveryError);
      assert.equal(error.failureClass, "PERMANENT");
      assert.equal(classifyOutboxDeliveryFailure(error, 1).state, "POISON");
      return true;
    });
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.LEADERBOARD_D1_WORKER_URL;
    else process.env.LEADERBOARD_D1_WORKER_URL = oldUrl;
    if (oldSecret === undefined) delete process.env.LEADERBOARD_D1_SYNC_SECRET;
    else process.env.LEADERBOARD_D1_SYNC_SECRET = oldSecret;
  }
});
