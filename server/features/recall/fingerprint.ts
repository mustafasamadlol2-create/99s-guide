import { createHash } from "node:crypto";
import { canonicalJson } from "../study-core/canonicalJson.js";
import type { RecallItemType } from "./constants.js";

export interface RecallIssuanceSemanticPayload {
  userId: string;
  itemType: RecallItemType;
  itemId: string;
  lectureId: string;
  issuanceIdempotencyKey: string;
  presentedAt?: Date;
  expiresAt?: Date | null;
}

export function recallIssuanceFingerprint(
  input: RecallIssuanceSemanticPayload,
): string {
  const payload = {
    contract: "spaced-recall-issuance-v1",
    userId: input.userId,
    itemType: input.itemType,
    itemId: input.itemId,
    lectureId: input.lectureId,
    issuanceIdempotencyKey: input.issuanceIdempotencyKey,
    presentedAt:
      input.presentedAt === undefined ? null : input.presentedAt.toISOString(),
    expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
  };
  return createHash("sha256")
    .update(canonicalJson(payload), "utf8")
    .digest("hex");
}

export function recallLockKey(scope: string, parts: readonly string[]): string {
  return canonicalJson(["spaced-recall", scope, ...parts]);
}