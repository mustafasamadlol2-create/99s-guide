import { Prisma } from "@prisma/client";
import type { LeaderboardSnapshotType } from "./types.js";

type Transaction = Prisma.TransactionClient;

export async function acquireLeaderboardSnapshotLock(
  tx: Transaction,
  seasonId: string,
  snapshotType: LeaderboardSnapshotType,
  tryOnly = false,
): Promise<boolean> {
  const lockKey = `leaderboard:${seasonId}:${snapshotType}`;
  if (tryOnly) {
    const rows = await tx.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
      WITH lock_result AS MATERIALIZED (
        SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) AS acquired
      )
      SELECT acquired AS locked FROM lock_result
    `);
    return rows[0]?.locked === true;
  }
  const rows = await tx.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
    WITH lock_result AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    )
    SELECT TRUE AS locked FROM lock_result
  `);
  return rows[0]?.locked === true;
}

export async function acquireLeaderboardSeasonLocks(
  tx: Transaction,
  seasonId: string,
  types: readonly LeaderboardSnapshotType[],
): Promise<void> {
  for (const type of [...new Set(types)].sort()) {
    await acquireLeaderboardSnapshotLock(tx, seasonId, type);
  }
}