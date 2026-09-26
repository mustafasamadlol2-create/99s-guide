import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { isStudyFeatureEnabled } from "../study-core/featureFlags.js";
import { logger } from "../../services/logger.js";
import {
  buildLeaderboardCacheManifest,
  chunkHash,
  LEADERBOARD_CACHE_CHUNK_SIZE,
  LEADERBOARD_CACHE_MAX_ENTRIES,
  requestLeaderboardD1,
  toCacheEntry,
  type LeaderboardCacheEntry,
} from "./cacheProtocol.js";

type Executor = Prisma.TransactionClient | PrismaClient;
type WorkType = "BEGIN" | "CHUNK" | "COMMIT";
type QueueRow = {
  id: string;
  workType: WorkType;
  snapshotId: string;
  chunkIndex: number;
  payload: Record<string, unknown>;
  attempts: number;
  leaseGeneration: number;
};

function enabled(): boolean {
  return isStudyFeatureEnabled("LEADERBOARD_D1_PROJECTION_ENABLED");
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/(?:secret|token|password|authorization|signature)[^,;\s]*/giu, "[REDACTED]")
    .slice(0, 500);
}

export async function enqueueLeaderboardSnapshotProjection(
  tx: Executor,
  input: {
    season: {
      id: string; scope: string; seasonKey: string; status: string;
      startsAt: Date | null; endsAt: Date | null;
    };
    snapshot: {
      id: string; snapshotType: string; revision: number; generatedAt: Date;
      scoreThrough: Date; sourceFingerprint: string; entryCount: number;
      rankingSemanticsVersion: string;
    };
    entries: Array<{
      userId: string | null; rank: number; tieSize: number; score: bigint;
      levelSnapshot: number | null;
    }>;
  },
): Promise<boolean> {
  if (!enabled()) return false;
  if (input.entries.length > LEADERBOARD_CACHE_MAX_ENTRIES) {
    logger.warn(
      "[LeaderboardD1]",
      `Projection skipped for snapshot ${input.snapshot.id}: ${input.entries.length} entries exceeds the D1 limit of ${LEADERBOARD_CACHE_MAX_ENTRIES}. PostgreSQL remains canonical.`,
    );
    return false;
  }
  const entries = input.entries.map(toCacheEntry);
  const manifest = buildLeaderboardCacheManifest(
    input.season,
    input.snapshot,
    input.entries,
  );
  const beginPayload = { manifest };
  await tx.leaderboardD1SyncOutbox.upsert({
    where: {
      snapshotId_workType_chunkIndex: {
        snapshotId: input.snapshot.id, workType: "BEGIN", chunkIndex: -1,
      },
    },
    update: {},
    create: { snapshotId: input.snapshot.id, workType: "BEGIN", chunkIndex: -1, payload: beginPayload },
  });
  for (let index = 0; index < entries.length; index += LEADERBOARD_CACHE_CHUNK_SIZE) {
    const chunkIndex = Math.floor(index / LEADERBOARD_CACHE_CHUNK_SIZE);
    const chunk = entries.slice(index, index + LEADERBOARD_CACHE_CHUNK_SIZE);
    const payload = {
      manifest,
      chunkIndex,
      entries: chunk,
      chunkHash: chunkHash(input.snapshot.id, chunkIndex, chunk),
    };
    await tx.leaderboardD1SyncOutbox.upsert({
      where: {
        snapshotId_workType_chunkIndex: {
          snapshotId: input.snapshot.id, workType: "CHUNK", chunkIndex,
        },
      },
      update: {},
      create: { snapshotId: input.snapshot.id, workType: "CHUNK", chunkIndex, payload },
    });
  }
  await tx.leaderboardD1SyncOutbox.upsert({
    where: {
      snapshotId_workType_chunkIndex: {
        snapshotId: input.snapshot.id, workType: "COMMIT", chunkIndex: -1,
      },
    },
    update: {},
    create: { snapshotId: input.snapshot.id, workType: "COMMIT", chunkIndex: -1, payload: { manifest } },
  });
  return true;
}

export async function reprojectLeaderboardSnapshot(
  snapshotId: string,
  database: PrismaClient = getPrisma() as PrismaClient,
): Promise<number> {
  return database.$transaction(async (tx) => {
    const snapshot = await tx.leaderboardSnapshot.findUnique({
      where: { id: snapshotId },
      include: { season: true, entries: { orderBy: [{ rank: "asc" }, { score: "desc" }, { userId: "asc" }] } },
    });
    if (!snapshot || snapshot.status !== "READY") throw new Error("Canonical leaderboard snapshot is not READY.");
    const queued = await enqueueLeaderboardSnapshotProjection(tx, {
      season: snapshot.season,
      snapshot,
      entries: snapshot.entries,
    });
    return queued ? snapshot.entries.length : 0;
  });
}

async function leaseBatch(): Promise<QueueRow[]> {
  const db = getPrisma();
  const rows = await db.$queryRaw(Prisma.sql`
    WITH picked AS (
      SELECT "id" FROM "LeaderboardD1SyncOutbox"
      WHERE "nextAttemptAt" <= NOW()
        AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW())
      ORDER BY "id" ASC LIMIT 25
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "LeaderboardD1SyncOutbox" AS outbox
    SET "attempts" = outbox."attempts" + 1,
        "leaseGeneration" = outbox."leaseGeneration" + 1,
        "leaseUntil" = NOW() + INTERVAL '60 seconds',
        "updatedAt" = NOW()
    FROM picked WHERE outbox."id" = picked."id"
    RETURNING outbox."id"::text AS "id", outbox."workType", outbox."snapshotId",
      outbox."chunkIndex", outbox."payload", outbox."attempts", outbox."leaseGeneration"
  `) as QueueRow[];
  return rows;
}

async function deliver(row: QueueRow): Promise<void> {
  const path = row.workType === "BEGIN"
    ? "/internal/leaderboard-cache/begin"
    : row.workType === "CHUNK"
      ? "/internal/leaderboard-cache/chunk"
      : "/internal/leaderboard-cache/commit";
  await requestLeaderboardD1(path, row.payload);
}

async function acknowledge(row: QueueRow): Promise<void> {
  await getPrisma().$executeRaw`
    DELETE FROM "LeaderboardD1SyncOutbox"
    WHERE "id" = ${row.id}::bigint AND "leaseGeneration" = ${row.leaseGeneration}
  `;
}

async function fail(row: QueueRow, error: unknown): Promise<void> {
  const seconds = Math.min(300, 15 * 2 ** Math.min(Math.max(row.attempts - 1, 0), 5));
  await getPrisma().$executeRaw`
    UPDATE "LeaderboardD1SyncOutbox"
    SET "lastError" = ${safeError(error)},
        "nextAttemptAt" = NOW() + (${String(seconds)} || ' seconds')::interval,
        "leaseUntil" = NULL, "updatedAt" = NOW()
    WHERE "id" = ${row.id}::bigint AND "leaseGeneration" = ${row.leaseGeneration}
  `;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let stopping = false;

export async function drainLeaderboardD1Outbox(): Promise<void> {
  if (running || stopping || !enabled()) return;
  running = true;
  try {
    for (const row of await leaseBatch()) {
      try { await deliver(row); await acknowledge(row); }
      catch (error) { await fail(row, error); logger.warn("[LeaderboardD1]", `Projection work remains queued: ${safeError(error)}`); }
    }
  } catch (error) {
    logger.warn("[LeaderboardD1]", `Projection drain failed: ${safeError(error)}`);
  } finally { running = false; }
  if (!stopping && enabled()) {
    timer = setTimeout(() => { timer = null; void drainLeaderboardD1Outbox(); }, 15_000);
    timer.unref?.();
  }
}

export function startLeaderboardD1OutboxDrainer(): void {
  stopping = false;
  if (enabled()) void drainLeaderboardD1Outbox();
}

export function stopLeaderboardD1OutboxDrainer(): void {
  stopping = true;
  if (timer) { clearTimeout(timer); timer = null; }
}