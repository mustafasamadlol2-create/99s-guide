import type { Prisma } from "@prisma/client";
import { canonicalJson } from "../study-core/canonicalJson.js";

export function studyPointsIdempotencyLockKey(
  userId: string,
  idempotencyKey: string,
): string {
  return `study-points:idempotency:${canonicalJson([userId, idempotencyKey])}`;
}

export function studyPointsReversalLockKey(entryId: string): string {
  return `study-points:reversal:${entryId}`;
}

export function studyPointsBalanceProjectionLockKey(userId: string): string {
  return `study-points:balance-projection:${userId}`;
}

export async function lockStudyPointsKeys(
  tx: Prisma.TransactionClient,
  lockKeys: readonly string[],
): Promise<void> {
  for (const lockKey of [...new Set(lockKeys)].sort()) {
    await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT TRUE AS locked
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))) AS acquired
    `;
  }
}