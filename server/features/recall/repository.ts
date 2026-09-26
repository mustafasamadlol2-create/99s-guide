import type { RecallItemState } from "@prisma/client";
import type { RecallItemType } from "./constants.js";
import { recallLockKey } from "./fingerprint.js";
import type {
  DerivedRecallItemState,
  RecallAttemptFact,
  RecallTransaction,
} from "./types.js";

export async function lockRecallScope(
  tx: RecallTransaction,
  scope: string,
  parts: readonly string[],
): Promise<void> {
  await tx.$queryRawUnsafe(
    "SELECT TRUE AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended($1, 0))) AS acquired",
    recallLockKey(scope, parts),
  );
}

export async function lockRecallAttempt(
  tx: RecallTransaction,
  userId: string,
  attemptId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "RecallAttempt"
    WHERE "id" = ${attemptId} AND "userId" = ${userId}
    FOR UPDATE
  `;
  return rows.length > 0;
}

export async function lockRecallItemState(
  tx: RecallTransaction,
  userId: string,
  itemType: RecallItemType,
  itemId: string,
): Promise<RecallItemState | null> {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "RecallItemState"
    WHERE "userId" = ${userId}
      AND "itemType" = ${itemType}
      AND "itemId" = ${itemId}
    FOR UPDATE
  `;
  return tx.recallItemState.findUnique({
    where: { userId_itemType_itemId: { userId, itemType, itemId } },
  });
}

export async function readRecallItemHistory(
  tx: RecallTransaction,
  userId: string,
  itemType: RecallItemType,
  itemId: string,
): Promise<RecallAttemptFact[]> {
  const rows = await tx.recallAttempt.findMany({
    where: { userId, itemType, itemId },
    orderBy: [{ presentedAt: "asc" }, { id: "asc" }],
  });
  return rows as unknown as RecallAttemptFact[];
}

export async function createRecallItemState(
  tx: RecallTransaction,
  userId: string,
  itemType: RecallItemType,
  itemId: string,
  derived: DerivedRecallItemState,
): Promise<RecallItemState> {
  return tx.recallItemState.create({
    data: {
      userId,
      itemType,
      itemId,
      ...derived,
    },
  });
}