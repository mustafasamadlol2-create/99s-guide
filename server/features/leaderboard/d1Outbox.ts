import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { isStudyFeatureEnabled } from "../study-core/featureFlags.js";
import { logger } from "../../services/logger.js";
import {
  buildLeaderboardCacheManifest,
  chunkHash,
  LEADERBOARD_CACHE_CHUNK_SIZE,
  LEADERBOARD_CACHE_MAX_ENTRIES,
  getLeaderboardD1Config,
  requestLeaderboardD1,
  toCacheEntry,
  type LeaderboardCacheEntry,
} from "./cacheProtocol.js";
import {
  classifyOutboxDeliveryFailure,
  OUTBOX_MAX_DELIVERY_ATTEMPTS,
  outboxRetryDelayMs,
} from "../../services/outboxDeliveryPolicy.js";

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
  projectionGeneration: number;
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
    projectionGeneration?: number;
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
  const projectionGeneration = input.projectionGeneration ?? 0;
  await tx.leaderboardD1SyncOutbox.upsert({
    where: {
      snapshotId_workType_chunkIndex_projectionGeneration: {
        snapshotId: input.snapshot.id, workType: "BEGIN", chunkIndex: -1, projectionGeneration,
      },
    },
    update: {},
    create: {
      snapshotId: input.snapshot.id, workType: "BEGIN", chunkIndex: -1,
      projectionGeneration, payload: beginPayload,
    },
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
        snapshotId_workType_chunkIndex_projectionGeneration: {
          snapshotId: input.snapshot.id, workType: "CHUNK", chunkIndex, projectionGeneration,
        },
      },
      update: {},
      create: {
        snapshotId: input.snapshot.id, workType: "CHUNK", chunkIndex,
        projectionGeneration, payload,
      },
    });
  }
  await tx.leaderboardD1SyncOutbox.upsert({
    where: {
      snapshotId_workType_chunkIndex_projectionGeneration: {
        snapshotId: input.snapshot.id, workType: "COMMIT", chunkIndex: -1, projectionGeneration,
      },
    },
    update: {},
    create: {
      snapshotId: input.snapshot.id, workType: "COMMIT", chunkIndex: -1,
      projectionGeneration, payload: { manifest },
    },
  });
  return true;
}

export async function reprojectLeaderboardSnapshot(
  snapshotId: string,
  database: PrismaClient = getPrisma() as PrismaClient,
): Promise<number> {
  return database.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT COALESCE(
        (SELECT true
         FROM (SELECT pg_advisory_xact_lock(
           hashtext('leaderboard_d1_reproject'),
           hashtext(${snapshotId})
         )) AS lock_result),
        false
      ) AS "locked"
    `);
    const snapshot = await tx.leaderboardSnapshot.findUnique({
      where: { id: snapshotId },
      include: { season: true, entries: { orderBy: [{ rank: "asc" }, { score: "desc" }, { userId: "asc" }] } },
    });
    if (!snapshot || snapshot.status !== "READY") throw new Error("Canonical leaderboard snapshot is not READY.");
    const latestProjection = await tx.leaderboardD1SyncOutbox.findFirst({
      where: { snapshotId },
      orderBy: { projectionGeneration: "desc" },
      select: { projectionGeneration: true },
    });
    const projectionGeneration = (latestProjection?.projectionGeneration ?? -1) + 1;
    const queued = await enqueueLeaderboardSnapshotProjection(tx, {
      season: snapshot.season,
      snapshot,
      projectionGeneration,
      entries: snapshot.entries,
    });
    return queued ? snapshot.entries.length : 0;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

async function leaseBatch(): Promise<QueueRow[]> {
  const db = getPrisma();
  const rows = await db.$queryRaw(Prisma.sql`
    WITH exhausted AS (
      UPDATE "LeaderboardD1SyncOutbox"
      SET "state" = 'POISON',
          "failureClass" = 'PERMANENT',
          "failureCode" = 'MAX_ATTEMPTS',
          "lastError" = 'Maximum delivery attempts reached after lease expiry.',
          "terminalAt" = COALESCE("terminalAt", NOW()),
          "leaseUntil" = NULL,
          "updatedAt" = NOW()
      WHERE "state" IN ('PENDING', 'RETRY')
        AND "attempts" >= ${OUTBOX_MAX_DELIVERY_ATTEMPTS}
        AND ("leaseUntil" IS NULL OR "leaseUntil" <= NOW())
      RETURNING "id"
    ),
    picked AS (
      SELECT "id" FROM "LeaderboardD1SyncOutbox"
      WHERE "state" IN ('PENDING', 'RETRY')
        AND "attempts" < ${OUTBOX_MAX_DELIVERY_ATTEMPTS}
        AND "nextAttemptAt" <= NOW()
        AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW())
      ORDER BY "id" ASC LIMIT 25
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "LeaderboardD1SyncOutbox" AS outbox
    SET "attempts" = outbox."attempts" + 1,
        "leaseGeneration" = outbox."leaseGeneration" + 1,
        "leaseUntil" = NOW() + INTERVAL '60 seconds',
        "firstAttemptAt" = COALESCE(outbox."firstAttemptAt", NOW()),
        "lastAttemptAt" = NOW(),
        "updatedAt" = NOW()
    FROM picked WHERE outbox."id" = picked."id"
    RETURNING outbox."id"::text AS "id", outbox."workType", outbox."snapshotId",
      outbox."chunkIndex", outbox."payload", outbox."attempts", outbox."leaseGeneration",
      outbox."projectionGeneration"
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
    UPDATE "LeaderboardD1SyncOutbox"
    SET "state" = 'SUCCEEDED',
        "failureClass" = NULL,
        "failureCode" = NULL,
        "lastError" = NULL,
        "terminalAt" = NOW(),
        "leaseUntil" = NULL,
        "updatedAt" = NOW()
    WHERE "id" = ${row.id}::bigint
      AND "leaseGeneration" = ${row.leaseGeneration}
      AND "state" IN ('PENDING', 'RETRY')
      AND "leaseUntil" IS NOT NULL
  `;
}

async function fail(row: QueueRow, error: unknown): Promise<void> {
  const failure = classifyOutboxDeliveryFailure(error, row.attempts);
  const retryDelayMs = failure.state === "RETRY"
    ? outboxRetryDelayMs(row.attempts)
    : 0;
  await getPrisma().$executeRaw`
    UPDATE "LeaderboardD1SyncOutbox"
    SET "state" = ${failure.state},
        "failureClass" = ${failure.failureClass},
        "failureCode" = ${failure.failureCode},
        "lastError" = ${failure.message.slice(0, 500)},
        "terminalAt" = CASE WHEN ${failure.state} = 'POISON' THEN NOW() ELSE NULL END,
        "nextAttemptAt" = CASE
          WHEN ${failure.state} = 'RETRY'
            THEN NOW() + (${String(retryDelayMs)} || ' milliseconds')::interval
          ELSE "nextAttemptAt"
        END,
        "leaseUntil" = NULL,
        "updatedAt" = NOW()
    WHERE "id" = ${row.id}::bigint
      AND "leaseGeneration" = ${row.leaseGeneration}
      AND "state" IN ('PENDING', 'RETRY')
      AND "leaseUntil" IS NOT NULL
  `;
}

async function blockLeaderboardOutboxForConfiguration(): Promise<number> {
  return getPrisma().$executeRaw`
    UPDATE "LeaderboardD1SyncOutbox"
    SET "state" = 'BLOCKED',
        "failureClass" = 'AUTH_CONFIGURATION',
        "failureCode" = 'CONFIG_MISSING_OR_INVALID',
        "lastError" = 'Leaderboard D1 Worker configuration is missing or invalid.',
        "leaseUntil" = NULL,
        "updatedAt" = NOW()
    WHERE "state" IN ('PENDING', 'RETRY')
      AND ("leaseUntil" IS NULL OR "leaseUntil" <= NOW())
  `;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let stopping = false;

export async function drainLeaderboardD1Outbox(): Promise<void> {
  if (running || stopping || !enabled()) return;
  running = true;
  try {
    if (!getLeaderboardD1Config()) {
      const blocked = await blockLeaderboardOutboxForConfiguration();
      if (blocked > 0) {
        logger.error("[LeaderboardD1]", `${blocked} outbox entries are BLOCKED by Worker configuration.`);
      }
    } else {
      for (const row of await leaseBatch()) {
        try {
          await deliver(row);
          await acknowledge(row);
        } catch (error) {
          const failure = classifyOutboxDeliveryFailure(error, row.attempts);
          await fail(row, error);
          logger.warn(
            "[LeaderboardD1]",
            `Outbox entry ${row.id} is ${failure.state} (${failure.failureCode}).`,
          );
        }
      }
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