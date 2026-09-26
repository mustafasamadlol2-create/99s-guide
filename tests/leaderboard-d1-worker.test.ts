import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  buildLeaderboardCacheManifest,
  requestLeaderboardD1,
} from "../server/features/leaderboard/cacheProtocol.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = "cloudflare-private-data-api/wrangler.jsonc";
const SECRET = "prompt27-local-d1-test-secret";
const SCOPE = "WEEKLY";
const SEASON_KEY = "weekly:2026-W39";
const SEASON_ID = "prompt27-local-season";
const RANKING_VERSION = "leaderboard-ranking-v1";

type Entry = {
  userId: string;
  rank: number;
  tieSize: number;
  score: number;
  levelSnapshot: number | null;
};

type Manifest = {
  snapshotId: string;
  seasonId: string;
  scope: string;
  seasonKey: string;
  snapshotType: "LIVE" | "FINAL";
  revision: number;
  seasonStatus: string;
  startsAt: string;
  endsAt: string;
  generatedAt: string;
  scoreThrough: string;
  entryCount: number;
  sourceFingerprint: string;
  projectionChecksum: string;
  chunkCount: number;
  rankingVersion: string;
  cacheSchemaVersion: number;
};

const baseEntries: Entry[] = [
  { userId: "user-a", rank: 1, tieSize: 1, score: 100, levelSnapshot: 7 },
  { userId: "user-b", rank: 2, tieSize: 2, score: 50, levelSnapshot: 5 },
  { userId: "user-c", rank: 2, tieSize: 2, score: 50, levelSnapshot: null },
];

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function makeManifest(input: {
  snapshotId: string;
  snapshotType?: "LIVE" | "FINAL";
  revision: number;
  generatedAt: string;
  entries?: Entry[];
}): Manifest {
  const snapshotType = input.snapshotType ?? "LIVE";
  const values = [...(input.entries ?? baseEntries)].sort((a, b) =>
    a.rank - b.rank || b.score - a.score || a.userId.localeCompare(b.userId));
  const manifest: Manifest = {
    snapshotId: input.snapshotId,
    seasonId: SEASON_ID,
    scope: SCOPE,
    seasonKey: SEASON_KEY,
    snapshotType,
    revision: input.revision,
    seasonStatus: snapshotType === "FINAL" ? "CLOSED" : "ACTIVE",
    startsAt: "2026-09-21T00:00:00.000Z",
    endsAt: "2026-09-28T00:00:00.000Z",
    generatedAt: input.generatedAt,
    scoreThrough: input.generatedAt,
    entryCount: values.length,
    sourceFingerprint: "a".repeat(64),
    projectionChecksum: "",
    chunkCount: values.length === 0 ? 0 : Math.ceil(values.length / 100),
    rankingVersion: RANKING_VERSION,
    cacheSchemaVersion: 1,
  };
  manifest.projectionChecksum = sha256(JSON.stringify([
    manifest.snapshotId,
    manifest.revision,
    manifest.entryCount,
    manifest.rankingVersion,
    ...values.map((entry) => [
      entry.userId,
      entry.rank,
      entry.tieSize,
      entry.score,
      entry.levelSnapshot,
    ]),
  ]));
  return manifest;
}

async function allocatePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

function signedRequest(
  baseUrl: string,
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
  nonce = randomBytes(24).toString("base64url"),
): Promise<Response> {
  const url = new URL(path, baseUrl);
  const raw = method === "GET" ? "" : JSON.stringify(body ?? {});
  const timestamp = String(Date.now());
  const canonical = `${timestamp}.${nonce}.${method}.${url.pathname}.${url.search}.${sha256(raw)}`;
  const signature = createHmac("sha256", SECRET).update(canonical).digest("hex");
  return fetch(url, {
    method,
    headers: {
      "X-Leaderboard-Timestamp": timestamp,
      "X-Leaderboard-Nonce": nonce,
      "X-Leaderboard-Signature": signature,
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: raw } : {}),
  });
}

function readManifestPath(snapshotId: string, includeBuilding = false): string {
  const params = new URLSearchParams({ snapshotId });
  if (includeBuilding) params.set("includeBuilding", "true");
  return `/internal/leaderboard-cache/metadata?${params.toString()}`;
}

async function publish(
  baseUrl: string,
  manifest: Manifest,
  entries = baseEntries,
): Promise<void> {
  const begin = await signedRequest(
    baseUrl,
    "/internal/leaderboard-cache/begin",
    "POST",
    { manifest },
  );
  assert.equal(begin.status, 200);
  const chunkHash = sha256(JSON.stringify([manifest.snapshotId, 0, entries]));
  const chunk = await signedRequest(
    baseUrl,
    "/internal/leaderboard-cache/chunk",
    "POST",
    { manifest, chunkIndex: 0, entries, chunkHash },
  );
  assert.equal(chunk.status, 200);
  const commit = await signedRequest(
    baseUrl,
    "/internal/leaderboard-cache/commit",
    "POST",
    { manifest },
  );
  assert.equal(commit.status, 200);
}

async function sendChunk(
  baseUrl: string,
  manifest: Manifest,
  chunkIndex: number,
  entries: Entry[],
): Promise<Response> {
  return signedRequest(
    baseUrl,
    "/internal/leaderboard-cache/chunk",
    "POST",
    {
      manifest,
      chunkIndex,
      entries,
      chunkHash: sha256(JSON.stringify([manifest.snapshotId, chunkIndex, entries])),
    },
  );
}

async function startLocalWorker(): Promise<{
  baseUrl: string;
  process: ChildProcess;
  persistencePath: string;
}> {
  const persistencePath = await mkdtemp("/tmp/prompt27-local-d1-");
  const wranglerBin = resolve(ROOT, "node_modules/wrangler/bin/wrangler.js");
  const migrate = spawnSync(process.execPath, [
    wranglerBin, "d1", "migrations", "apply", "99s-guide-content",
    "--config", CONFIG, "--local", "--persist-to", persistencePath,
  ], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (migrate.status !== 0) {
    throw new Error(`Local D1 migrations failed:\n${migrate.stdout}\n${migrate.stderr}`);
  }
  const port = await allocatePort();
  const child = spawn(process.execPath, [
    wranglerBin, "dev", "--config", CONFIG, "--local",
    "--port", String(port),
    "--persist-to", persistencePath,
    "--var", `LEADERBOARD_D1_SYNC_SECRET:${SECRET}`,
  ], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let logs = "";
  child.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(baseUrl);
      if (response.status > 0) return { baseUrl, process: child, persistencePath };
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  child.kill("SIGTERM");
  await rm(persistencePath, { recursive: true, force: true });
  throw new Error(`Local Worker failed to start:\n${logs}`);
}

test("leaderboard cache Worker publishes and serves canonical snapshots locally", async (t) => {
  const worker = await startLocalWorker();
  t.after(async () => {
    if (worker.process.pid && worker.process.exitCode === null) {
      try {
        process.kill(-worker.process.pid, "SIGTERM");
      } catch {}
      await Promise.race([
        once(worker.process, "exit"),
        new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000)),
      ]);
    }
    await rm(worker.persistencePath, { recursive: true, force: true });
  });

  const { baseUrl } = worker;
  await t.test("requires signed internal requests", async () => {
    const response = await fetch(
      new URL("/internal/leaderboard-cache/current?scope=WEEKLY&seasonKey=x", baseUrl),
    );
    assert.equal(response.status, 401);
  });

  const now = Date.now();
  const initial = makeManifest({
    snapshotId: "prompt27-live-1",
    revision: 1,
    generatedAt: new Date(now).toISOString(),
  });

  await t.test("does not publish before all chunks arrive", async () => {
    const response = await signedRequest(
      baseUrl,
      "/internal/leaderboard-cache/commit",
      "POST",
      { manifest: initial },
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json() as { code: string }).code, "CACHE_INCOMPLETE");

    const replay = await signedRequest(
      baseUrl,
      "/internal/leaderboard-cache/begin",
      "POST",
      { manifest: initial },
    );
    assert.equal(replay.status, 200);
    const conflict = await signedRequest(
      baseUrl,
      "/internal/leaderboard-cache/begin",
      "POST",
      { manifest: { ...initial, sourceFingerprint: "b".repeat(64) } },
    );
    assert.equal(conflict.status, 409);
  });

  await t.test("commits a checked snapshot and pins keyset pages", async () => {
    await publish(baseUrl, initial);
    const currentParams = new URLSearchParams({ scope: SCOPE, seasonKey: SEASON_KEY });
    const currentResponse = await signedRequest(
      baseUrl,
      `/internal/leaderboard-cache/current?${currentParams.toString()}`,
      "GET",
    );
    assert.equal(currentResponse.status, 200);
    const current = await currentResponse.json() as { manifest: { snapshotId: string; state: string } };
    assert.equal(current.manifest.snapshotId, initial.snapshotId);
    assert.equal(current.manifest.state, "READY");

    const firstParams = new URLSearchParams({ snapshotId: initial.snapshotId, limit: "2" });
    const firstResponse = await signedRequest(
      baseUrl,
      `/internal/leaderboard-cache/page?${firstParams.toString()}`,
      "GET",
    );
    const first = await firstResponse.json() as {
      entries: Entry[];
      nextCursor: { afterRank: number; afterScore: number; afterUserId: string };
    };
    assert.deepEqual(first.entries.map((entry) => entry.userId), ["user-a", "user-b"]);
    assert.deepEqual(first.entries.map((entry) => entry.rank), [1, 2]);
    assert.deepEqual(first.nextCursor, { afterRank: 2, afterScore: 50, afterUserId: "user-b" });

    const nextParams = new URLSearchParams({
      snapshotId: initial.snapshotId,
      limit: "2",
      afterRank: "2",
      afterScore: "50",
      afterUserId: "user-b",
    });
    const nextResponse = await signedRequest(
      baseUrl,
      `/internal/leaderboard-cache/page?${nextParams.toString()}`,
      "GET",
    );
    const next = await nextResponse.json() as { entries: Entry[]; nextCursor: null };
    assert.deepEqual(next.entries.map((entry) => entry.userId), ["user-c"]);
    assert.equal(next.entries[0].rank, 2);
    assert.equal(next.nextCursor, null);

    const rankParams = new URLSearchParams({ snapshotId: initial.snapshotId, userId: "user-c" });
    const rankResponse = await signedRequest(
      baseUrl,
      `/internal/leaderboard-cache/rank?${rankParams.toString()}`,
      "GET",
    );
    const rank = await rankResponse.json() as { entry: { rank: number; tie_size: number } };
    assert.equal(rank.entry.rank, 2);
    assert.equal(rank.entry.tie_size, 2);

    const metadataResponse = await signedRequest(
      baseUrl,
      readManifestPath(initial.snapshotId),
      "GET",
    );
    const metadata = await metadataResponse.json() as {
      actualEntryCount: number;
      actualChunkCount: number;
      chunkIndexes: number[];
      actualProjectionChecksum: string;
    };
    assert.equal(metadata.actualEntryCount, 3);
    assert.equal(metadata.actualChunkCount, 1);
    assert.deepEqual(metadata.chunkIndexes, [0]);
    assert.equal(metadata.actualProjectionChecksum, initial.projectionChecksum);
  });

  await t.test("accepts out-of-order chunks but commits only complete projections", async () => {
    const entries: Entry[] = Array.from({ length: 1000 }, (_, index) => ({
      userId: `bulk-${String(index + 1).padStart(4, "0")}`,
      rank: index + 1,
      tieSize: 1,
      score: 1000 - index,
      levelSnapshot: index % 10,
    }));
    const manifest = makeManifest({
      snapshotId: "prompt27-live-multichunk",
      revision: 5,
      generatedAt: new Date(now + 300_000).toISOString(),
      entries,
    });
    const begin = await signedRequest(
      baseUrl,
      "/internal/leaderboard-cache/begin",
      "POST",
      { manifest },
    );
    assert.equal(begin.status, 200);

    const lastChunk = await sendChunk(baseUrl, manifest, 9, entries.slice(900));
    assert.equal(lastChunk.status, 200);
    const earlyCommit = await signedRequest(
      baseUrl,
      "/internal/leaderboard-cache/commit",
      "POST",
      { manifest },
    );
    assert.equal(earlyCommit.status, 409);

    for (let chunkIndex = 8; chunkIndex >= 0; chunkIndex -= 1) {
      const chunk = await sendChunk(
        baseUrl,
        manifest,
        chunkIndex,
        entries.slice(chunkIndex * 100, (chunkIndex + 1) * 100),
      );
      assert.equal(chunk.status, 200);
    }
    const commit = await signedRequest(
      baseUrl,
      "/internal/leaderboard-cache/commit",
      "POST",
      { manifest },
    );
    assert.equal(commit.status, 200);

    const metadataResponse = await signedRequest(
      baseUrl,
      readManifestPath(manifest.snapshotId),
      "GET",
    );
    const metadata = await metadataResponse.json() as {
      actualEntryCount: number;
      actualChunkCount: number;
      chunkIndexes: number[];
      actualProjectionChecksum: string;
    };
    assert.equal(metadata.actualEntryCount, 1000);
    assert.equal(metadata.actualChunkCount, 10);
    assert.deepEqual(metadata.chunkIndexes, Array.from({ length: 10 }, (_, index) => index));
    assert.equal(metadata.actualProjectionChecksum, manifest.projectionChecksum);

    const firstPageParams = new URLSearchParams({
      snapshotId: manifest.snapshotId,
      limit: "100",
    });
    const firstPageResponse = await signedRequest(
      baseUrl,
      `/internal/leaderboard-cache/page?${firstPageParams.toString()}`,
      "GET",
    );
    const firstPage = await firstPageResponse.json() as {
      entries: Entry[];
      nextCursor: { afterRank: number; afterScore: number; afterUserId: string };
    };
    assert.equal(firstPage.entries.length, 100);
    assert.equal(firstPage.nextCursor.afterUserId, "bulk-0100");

    const secondPageParams = new URLSearchParams({
      snapshotId: manifest.snapshotId,
      limit: "100",
      afterRank: String(firstPage.nextCursor.afterRank),
      afterScore: String(firstPage.nextCursor.afterScore),
      afterUserId: firstPage.nextCursor.afterUserId,
    });
    const secondPageResponse = await signedRequest(
      baseUrl,
      `/internal/leaderboard-cache/page?${secondPageParams.toString()}`,
      "GET",
    );
    const secondPage = await secondPageResponse.json() as {
      entries: Entry[];
      nextCursor: { afterRank: number; afterScore: number; afterUserId: string } | null;
    };
    assert.equal(secondPage.entries.length, 100);
    assert.equal(secondPage.entries[0].userId, "bulk-0101");
    assert.equal(secondPage.nextCursor?.afterUserId, "bulk-0200");

    const lastPageParams = new URLSearchParams({
      snapshotId: manifest.snapshotId,
      limit: "100",
      afterRank: "900",
      afterScore: "101",
      afterUserId: "bulk-0900",
    });
    const lastPageResponse = await signedRequest(
      baseUrl,
      `/internal/leaderboard-cache/page?${lastPageParams.toString()}`,
      "GET",
    );
    const lastPage = await lastPageResponse.json() as {
      entries: Entry[];
      nextCursor: null;
    };
    assert.equal(lastPage.entries.length, 100);
    assert.equal(lastPage.entries[0].userId, "bulk-0901");
    assert.equal(lastPage.entries[99].userId, "bulk-1000");
    assert.equal(lastPage.nextCursor, null);
  });

  await t.test("serializes concurrent manifest creation and rejects changed retries", async () => {
    const manifest = makeManifest({
      snapshotId: "prompt27-live-begin-race",
      revision: 6,
      generatedAt: new Date(now + 360_000).toISOString(),
    });
    const path = "/internal/leaderboard-cache/begin";
    const [first, second] = await Promise.all([
      signedRequest(baseUrl, path, "POST", { manifest }),
      signedRequest(baseUrl, path, "POST", { manifest }),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 200]);

    const conflicting = {
      ...manifest,
      sourceFingerprint: "c".repeat(64),
    };
    const [conflictA, conflictB] = await Promise.all([
      signedRequest(baseUrl, path, "POST", { manifest: conflicting }),
      signedRequest(baseUrl, path, "POST", { manifest: conflicting }),
    ]);
    assert.deepEqual([conflictA.status, conflictB.status].sort(), [409, 409]);
  });

  await t.test("accepts signed requests from the server cache client", async () => {
    const previousUrl = process.env.LEADERBOARD_D1_WORKER_URL;
    const previousSecret = process.env.LEADERBOARD_D1_SYNC_SECRET;
    process.env.LEADERBOARD_D1_WORKER_URL = baseUrl;
    process.env.LEADERBOARD_D1_SYNC_SECRET = SECRET;
    try {
      const params = new URLSearchParams({ scope: SCOPE, seasonKey: SEASON_KEY });
      const result = await requestLeaderboardD1<{
        ok: boolean;
        manifest: { snapshotId: string };
      }>(`/internal/leaderboard-cache/current?${params.toString()}`, undefined, {
        method: "GET",
      });
      assert.equal(result.ok, true);
      assert.equal(result.manifest.snapshotId, "prompt27-live-multichunk");
    } finally {
      if (previousUrl === undefined) delete process.env.LEADERBOARD_D1_WORKER_URL;
      else process.env.LEADERBOARD_D1_WORKER_URL = previousUrl;
      if (previousSecret === undefined) delete process.env.LEADERBOARD_D1_SYNC_SECRET;
      else process.env.LEADERBOARD_D1_SYNC_SECRET = previousSecret;
    }
  });

  await t.test("rejects conflicting chunk replay without corrupting stored rows", async () => {
    const conflict = [{ userId: "user-z", rank: 1, tieSize: 1, score: 999, levelSnapshot: null }];
    const chunkHash = sha256(JSON.stringify([initial.snapshotId, 0, conflict]));
    const response = await signedRequest(
      baseUrl,
      "/internal/leaderboard-cache/chunk",
      "POST",
      { manifest: initial, chunkIndex: 0, entries: conflict, chunkHash },
    );
    assert.equal(response.status, 409);
    const rankParams = new URLSearchParams({ snapshotId: initial.snapshotId, userId: "user-a" });
    const rankResponse = await signedRequest(
      baseUrl,
      `/internal/leaderboard-cache/rank?${rankParams.toString()}`,
      "GET",
    );
    const rank = await rankResponse.json() as { entry: { score: number } };
    assert.equal(rank.entry.score, 100);
  });

  await t.test("keeps current pointers version-aware and FINAL-preferred", async () => {
    const future = now + 120_000;
    const live2 = makeManifest({
      snapshotId: "prompt27-live-2",
      revision: 2,
      generatedAt: new Date(future).toISOString(),
    });
    const lateOlderLive = makeManifest({
      snapshotId: "prompt27-live-3-older",
      revision: 3,
      generatedAt: new Date(now + 60_000).toISOString(),
    });
    await publish(baseUrl, live2);
    await publish(baseUrl, lateOlderLive);

    const final1 = makeManifest({
      snapshotId: "prompt27-final-1",
      snapshotType: "FINAL",
      revision: 1,
      generatedAt: new Date(now + 180_000).toISOString(),
    });
    await publish(baseUrl, final1);
    await publish(baseUrl, lateOlderLive);
    const final2 = makeManifest({
      snapshotId: "prompt27-final-2",
      snapshotType: "FINAL",
      revision: 2,
      generatedAt: new Date(now + 240_000).toISOString(),
    });
    await publish(baseUrl, final2);

    const currentParams = new URLSearchParams({ scope: SCOPE, seasonKey: SEASON_KEY });
    const response = await signedRequest(
      baseUrl,
      `/internal/leaderboard-cache/current?${currentParams.toString()}`,
      "GET",
    );
    const current = await response.json() as { manifest: { snapshotId: string; revision: number } };
    assert.equal(current.manifest.snapshotId, final2.snapshotId);
    assert.equal(current.manifest.revision, 2);
  });

  await t.test("serializes conflicting concurrent chunks without overwriting the winner", async () => {
    const manifest = makeManifest({
      snapshotId: "prompt27-live-race",
      revision: 4,
      generatedAt: new Date(now + 300_000).toISOString(),
    });
    const begin = await signedRequest(
      baseUrl,
      "/internal/leaderboard-cache/begin",
      "POST",
      { manifest },
    );
    assert.equal(begin.status, 200);
    const competingEntries = baseEntries.map((entry) => ({
      ...entry,
      score: entry.score + (entry.userId === "user-a" ? 9 : 0),
    }));
    const [first, second] = await Promise.all([
      signedRequest(
        baseUrl,
        "/internal/leaderboard-cache/chunk",
        "POST",
        {
          manifest,
          chunkIndex: 0,
          entries: baseEntries,
          chunkHash: sha256(JSON.stringify([manifest.snapshotId, 0, baseEntries])),
        },
      ),
      signedRequest(
        baseUrl,
        "/internal/leaderboard-cache/chunk",
        "POST",
        {
          manifest,
          chunkIndex: 0,
          entries: competingEntries,
          chunkHash: sha256(JSON.stringify([manifest.snapshotId, 0, competingEntries])),
        },
      ),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 409]);
    const metadataResponse = await signedRequest(
      baseUrl,
      readManifestPath(manifest.snapshotId, true),
      "GET",
    );
    const metadata = await metadataResponse.json() as { actualProjectionChecksum: string };
    const baseChecksum = sha256(JSON.stringify([
      manifest.snapshotId,
      manifest.revision,
      manifest.entryCount,
      manifest.rankingVersion,
      ...baseEntries.map((entry) => [
        entry.userId, entry.rank, entry.tieSize, entry.score, entry.levelSnapshot,
      ]),
    ]));
    const competingChecksum = sha256(JSON.stringify([
      manifest.snapshotId,
      manifest.revision,
      manifest.entryCount,
      manifest.rankingVersion,
      ...competingEntries.map((entry) => [
        entry.userId, entry.rank, entry.tieSize, entry.score, entry.levelSnapshot,
      ]),
    ]));
    assert.ok(
      metadata.actualProjectionChecksum === baseChecksum
      || metadata.actualProjectionChecksum === competingChecksum,
    );
  });

  await t.test("rejects replayed authentication nonces and resets only derived cache", async () => {
    const nonce = randomBytes(24).toString("base64url");
    const path = "/internal/leaderboard-cache/current?scope=WEEKLY&seasonKey=weekly%3A2026-W39";
    const first = await signedRequest(baseUrl, path, "GET", undefined, nonce);
    const replay = await signedRequest(baseUrl, path, "GET", undefined, nonce);
    assert.equal(first.status, 200);
    assert.equal(replay.status, 409);

    const reset = await signedRequest(
      baseUrl,
      "/internal/leaderboard-cache/reset",
      "POST",
      { snapshotId: "prompt27-final-2" },
    );
    assert.equal(reset.status, 200);
    const params = new URLSearchParams({ scope: SCOPE, seasonKey: SEASON_KEY });
    const current = await signedRequest(
      baseUrl,
      `/internal/leaderboard-cache/current?${params.toString()}`,
      "GET",
    );
    const currentBody = await current.json() as { manifest?: unknown };
    assert.equal(currentBody.manifest, null);
  });
});

test("server cache manifests match canonical snapshot metadata", () => {
  const season = {
    id: "prompt27-manifest-season",
    scope: SCOPE,
    seasonKey: SEASON_KEY,
    status: "ACTIVE",
    startsAt: new Date("2026-09-21T00:00:00.000Z"),
    endsAt: new Date("2026-09-28T00:00:00.000Z"),
  };
  const snapshot = {
    id: "prompt27-manifest-snapshot",
    snapshotType: "LIVE",
    revision: 1,
    generatedAt: new Date("2026-09-26T00:00:00.000Z"),
    scoreThrough: new Date("2026-09-26T00:00:00.000Z"),
    sourceFingerprint: "b".repeat(64),
    entryCount: baseEntries.length,
    rankingSemanticsVersion: RANKING_VERSION,
  };
  const entries = baseEntries.map((entry) => ({ ...entry, score: BigInt(entry.score) }));
  const manifest = buildLeaderboardCacheManifest(season, snapshot, entries);
  assert.equal(manifest.entryCount, baseEntries.length);
  assert.equal(manifest.chunkCount, 1);
  assert.equal(manifest.rankingVersion, RANKING_VERSION);
  assert.throws(
    () => buildLeaderboardCacheManifest(
      season,
      { ...snapshot, rankingSemanticsVersion: "unknown-ranking-version" },
      entries,
    ),
    /ranking version/u,
  );
  assert.throws(
    () => buildLeaderboardCacheManifest(
      season,
      { ...snapshot, entryCount: snapshot.entryCount - 1 },
      entries,
    ),
    /entry count/u,
  );
  assert.throws(
    () => buildLeaderboardCacheManifest(
      season,
      snapshot,
      entries.map((entry, index) => index === 0 ? { ...entry, score: 0n } : entry),
    ),
    /Invalid score/u,
  );
});