import type { Prisma } from "@prisma/client";
import { canonicalJson } from "../../study-core/canonicalJson.js";

export type IntegritySignalDedupIdentity = {
  userId: string;
  signalFingerprint: string;
  dedupBucket: number;
};

export function integritySignalDedupLockKey(
  identity: IntegritySignalDedupIdentity,
): string {
  return `study-integrity:${canonicalJson([
    identity.userId,
    identity.signalFingerprint,
    identity.dedupBucket,
  ])}`;
}

export async function lockIntegritySignalDedupKey(
  tx: Prisma.TransactionClient,
  identity: IntegritySignalDedupIdentity,
): Promise<void> {
  const lockKey = integritySignalDedupLockKey(identity);
  await tx.$queryRaw<{ locked: boolean }[]>`
    SELECT TRUE AS locked
    FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))) AS acquired
  `;
}