import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { isStudyFeatureEnabled } from "../study-core/featureFlags.js";
import {
  buildLeaderboardCacheManifest,
  getLeaderboardD1Config,
  LEADERBOARD_CACHE_MAX_ENTRIES,
  LEADERBOARD_CACHE_RANKING_VERSION,
  LEADERBOARD_CACHE_SCHEMA_VERSION,
  requestLeaderboardD1,
  resetLeaderboardD1Snapshot,
} from "./cacheProtocol.js";
import { reprojectLeaderboardSnapshot } from "./d1Outbox.js";
import {
  getLatestLeaderboardSnapshot,
  LEADERBOARD_LIVE_HARD_STALE_MS,
} from "./snapshots.js";

type CheckStatus = "PASS" | "FAIL" | "UNAVAILABLE";
type ReconciliationCheck = {
  code: string;
  status: CheckStatus;
  expected?: unknown;
  actual?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function check(
  code: string,
  passed: boolean,
  expected?: unknown,
  actual?: unknown,
): ReconciliationCheck {
  return {
    code,
    status: passed ? "PASS" : "FAIL",
    ...(expected === undefined ? {} : { expected }),
    ...(actual === undefined ? {} : { actual }),
  };
}

function failureCheck(code: string, actual?: unknown): ReconciliationCheck {
  return {
    code,
    status: "UNAVAILABLE",
    ...(actual === undefined ? {} : { actual }),
  };
}

function safelyReadManifest(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function workerErrorStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const match = /Worker HTTP (\d{3})/u.exec(error.message);
  return match ? Number(match[1]) : null;
}

export async function reconcileLeaderboardD1Cache(input: {
  snapshotId: string;
  database?: PrismaClient;
}): Promise<{
  snapshotId: string;
  status: "MATCHED" | "MISMATCH" | "UNAVAILABLE";
  checks: ReconciliationCheck[];
  cache: Record<string, unknown> | null;
}> {
  const database = input.database ?? getPrisma() as PrismaClient;
  const snapshot = await database.leaderboardSnapshot.findUnique({
    where: { id: input.snapshotId },
    include: {
      season: true,
      entries: { orderBy: [{ rank: "asc" }, { score: "desc" }, { userId: "asc" }] },
    },
  });
  if (!snapshot || snapshot.status !== "READY") {
    throw new Error("Canonical leaderboard snapshot is not READY.");
  }
  const expected = buildLeaderboardCacheManifest(
    snapshot.season,
    snapshot,
    snapshot.entries,
  );
  const checks: ReconciliationCheck[] = [];
  if (!getLeaderboardD1Config()) {
    return {
      snapshotId: snapshot.id,
      status: "UNAVAILABLE",
      checks: [failureCheck("D1_UNAVAILABLE", "Worker URL or sync secret is missing/invalid.")],
      cache: null,
    };
  }

  let metadata: Record<string, unknown>;
  try {
    const params = new URLSearchParams({
      snapshotId: snapshot.id,
      includeBuilding: "true",
    });
    const result = await requestLeaderboardD1<Record<string, unknown>>(
      `/internal/leaderboard-cache/metadata?${params.toString()}`,
      undefined,
      { method: "GET" },
    );
    if (!isRecord(result) || result.ok !== true) {
      throw new Error("Worker metadata response is invalid.");
    }
    metadata = result;
  } catch (error) {
    const httpStatus = workerErrorStatus(error);
    if (httpStatus === 404) {
      checks.push(check("CACHE_MISSING", false, "READY cache snapshot", "missing"));
      return {
        snapshotId: snapshot.id,
        status: "MISMATCH",
        checks,
        cache: null,
      };
    }
    return {
      snapshotId: snapshot.id,
      status: "UNAVAILABLE",
      checks: [failureCheck("D1_UNAVAILABLE", httpStatus ?? "Worker request failed.")],
      cache: null,
    };
  }

  const manifest = safelyReadManifest(metadata.manifest);
  const actualEntryCount = metadata.actualEntryCount;
  const actualChunkCount = metadata.actualChunkCount;
  const chunkIndexes = Array.isArray(metadata.chunkIndexes)
    ? metadata.chunkIndexes
    : [];
  const actualProjectionChecksum = metadata.actualProjectionChecksum;
  const state = manifest?.state;
  checks.push(check("CACHE_MISSING", true, "present", "present"));
  checks.push(check("CACHE_BUILDING", state === "READY", "READY", state));
  checks.push(check(
    "CACHE_SCHEMA_MISMATCH",
    manifest?.cacheSchemaVersion === LEADERBOARD_CACHE_SCHEMA_VERSION,
    LEADERBOARD_CACHE_SCHEMA_VERSION,
    manifest?.cacheSchemaVersion,
  ));
  checks.push(check(
    "RANKING_VERSION_MISMATCH",
    manifest?.rankingVersion === LEADERBOARD_CACHE_RANKING_VERSION,
    LEADERBOARD_CACHE_RANKING_VERSION,
    manifest?.rankingVersion,
  ));
  checks.push(check(
    "ENTRY_COUNT_MISMATCH",
    manifest?.entryCount === expected.entryCount
      && actualEntryCount === expected.entryCount,
    expected.entryCount,
    { manifest: manifest?.entryCount, actual: actualEntryCount },
  ));
  checks.push(check(
    "SOURCE_FINGERPRINT_MISMATCH",
    manifest?.sourceFingerprint === expected.sourceFingerprint,
    expected.sourceFingerprint,
    manifest?.sourceFingerprint,
  ));
  checks.push(check(
    "PROJECTION_CHECKSUM_MISMATCH",
    manifest?.projectionChecksum === expected.projectionChecksum
      && actualProjectionChecksum === expected.projectionChecksum,
    expected.projectionChecksum,
    { manifest: manifest?.projectionChecksum, actual: actualProjectionChecksum },
  ));
  const indexesAreComplete = chunkIndexes.length === expected.chunkCount
    && chunkIndexes.every((index, position) => index === position);
  checks.push(check(
    "MISSING_CHUNKS",
    manifest?.chunkCount === expected.chunkCount
      && actualChunkCount === expected.chunkCount
      && indexesAreComplete,
    { count: expected.chunkCount, indexes: Array.from({ length: expected.chunkCount }, (_, i) => i) },
    { count: actualChunkCount, indexes: chunkIndexes },
  ));
  checks.push(check(
    "SNAPSHOT_METADATA_MISMATCH",
    manifest?.snapshotId === snapshot.id
      && manifest?.seasonId === snapshot.seasonId
      && manifest?.scope === snapshot.season.scope
      && manifest?.seasonKey === snapshot.season.seasonKey
      && manifest?.snapshotType === snapshot.snapshotType
      && manifest?.revision === snapshot.revision
      && manifest?.generatedAt === snapshot.generatedAt.toISOString()
      && manifest?.scoreThrough === snapshot.scoreThrough.toISOString(),
    {
      snapshotId: snapshot.id,
      seasonId: snapshot.seasonId,
      snapshotType: snapshot.snapshotType,
      revision: snapshot.revision,
    },
    {
      snapshotId: manifest?.snapshotId,
      seasonId: manifest?.seasonId,
      snapshotType: manifest?.snapshotType,
      revision: manifest?.revision,
    },
  ));
  const age = Date.now() - snapshot.generatedAt.getTime();
  checks.push(check(
    "STALE_LIVE_CACHE",
    snapshot.snapshotType !== "LIVE" || age <= LEADERBOARD_LIVE_HARD_STALE_MS,
    `LIVE age <= ${LEADERBOARD_LIVE_HARD_STALE_MS}ms or FINAL`,
    snapshot.snapshotType === "LIVE" ? age : "FINAL",
  ));

  const latest = await getLatestLeaderboardSnapshot(
    snapshot.seasonId,
    snapshot.season.status === "CLOSED" ? "FINAL" : "LIVE",
    database,
  );
  let currentManifest: Record<string, unknown> | null = null;
  try {
    const params = new URLSearchParams({
      scope: snapshot.season.scope,
      seasonKey: snapshot.season.seasonKey,
    });
    const result = await requestLeaderboardD1<Record<string, unknown>>(
      `/internal/leaderboard-cache/current?${params.toString()}`,
      undefined,
      { method: "GET" },
    );
    if (isRecord(result) && result.ok === true) {
      currentManifest = safelyReadManifest(result.manifest);
    }
  } catch {
    checks.push(failureCheck("CURRENT_POINTER_UNAVAILABLE"));
  }
  if (latest && !checks.some((item) => item.code === "CURRENT_POINTER_UNAVAILABLE")) {
    checks.push(check(
      "CURRENT_POINTER_MISMATCH",
      currentManifest?.snapshotId === latest.id,
      latest.id,
      currentManifest?.snapshotId ?? null,
    ));
  }

  const failed = checks.some((item) => item.status === "FAIL");
  const unavailable = checks.some((item) => item.status === "UNAVAILABLE");
  return {
    snapshotId: snapshot.id,
    status: failed ? "MISMATCH" : unavailable ? "UNAVAILABLE" : "MATCHED",
    checks,
    cache: {
      state: manifest?.state ?? null,
      snapshotId: manifest?.snapshotId ?? null,
      entryCount: actualEntryCount,
      chunkCount: actualChunkCount,
      actualProjectionChecksum,
    },
  };
}

export async function repairLeaderboardD1Cache(input: {
  snapshotId: string;
  database?: PrismaClient;
}): Promise<{
  snapshotId: string;
  reset: true;
  queuedEntries: number;
}> {
  if (!isStudyFeatureEnabled("LEADERBOARD_D1_PROJECTION_ENABLED")) {
    throw new Error("Leaderboard D1 projection is disabled.");
  }
  const database = input.database ?? getPrisma() as PrismaClient;
  const snapshot = await database.leaderboardSnapshot.findUnique({
    where: { id: input.snapshotId },
    select: { id: true, status: true, entryCount: true },
  });
  if (!snapshot || snapshot.status !== "READY") {
    throw new Error("Canonical leaderboard snapshot is not READY.");
  }
  if (snapshot.entryCount > LEADERBOARD_CACHE_MAX_ENTRIES) {
    throw new Error(
      `Canonical leaderboard snapshot exceeds the D1 projection limit of ${LEADERBOARD_CACHE_MAX_ENTRIES} entries.`,
    );
  }
  await resetLeaderboardD1Snapshot(input.snapshotId);
  const queuedEntries = await reprojectLeaderboardSnapshot(
    input.snapshotId,
    database,
  );
  return {
    snapshotId: input.snapshotId,
    reset: true,
    queuedEntries,
  };
}
