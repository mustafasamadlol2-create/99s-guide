import type { Prisma } from "@prisma/client";
import { INTEGRITY_ACTION_TYPES } from "../../study-integrity/constants.js";

export type VerifiedRecallSource = {
  userId: string;
  sourceId: string;
  effectiveAt: Date;
  evidenceClass: string;
  source: "backend";
  actionType: string;
  resource: { kind: "recall_attempt"; id: string };
};

export type RecallSourceLoadResult =
  | { source: VerifiedRecallSource }
  | { reason: "NOT_ELIGIBLE" | "INSUFFICIENT_EVIDENCE" };

/**
 * Loads the attempt as part of the caller's Points transaction. Provenance
 * fields are intentionally selected dynamically so this module remains
 * compatible with Prisma clients generated before the additive Prompt 30
 * migration has been applied.
 */
export async function loadObjectiveRecallSource(
  tx: Prisma.TransactionClient,
  userId: string,
  sourceId: string,
): Promise<RecallSourceLoadResult> {
  const attempt = await (tx as unknown as {
    recallAttempt: {
      findFirst(args: unknown): Promise<{
        id: string;
        userId: string;
        itemType: string;
        status: string;
        outcome: string | null;
        evidenceClass: string | null;
        answeredAt: Date | null;
        issuanceSource?: string;
        issuancePolicyVersion?: string | null;
      } | null>;
    };
  }).recallAttempt.findFirst({
    where: { id: sourceId, userId },
    select: {
      id: true,
      userId: true,
      itemType: true,
      status: true,
      outcome: true,
      evidenceClass: true,
      answeredAt: true,
      issuanceSource: true,
      issuancePolicyVersion: true,
    },
  });
  if (
    !attempt
    || attempt.itemType !== "MCQ"
    || attempt.status !== "ANSWERED"
    || attempt.outcome !== "CORRECT"
    || attempt.evidenceClass !== "SERVER_DERIVED"
    || attempt.issuanceSource !== "PERIODIC"
    || attempt.issuancePolicyVersion !== "recall-policy-v1"
    || !(attempt.answeredAt instanceof Date)
    || !Number.isFinite(attempt.answeredAt.getTime())
  ) {
    return { reason: "NOT_ELIGIBLE" };
  }
  return {
    source: {
      userId,
      sourceId: attempt.id,
      effectiveAt: attempt.answeredAt,
      evidenceClass: attempt.evidenceClass,
      source: "backend",
      actionType: INTEGRITY_ACTION_TYPES.RECALL_ANSWER,
      resource: { kind: "recall_attempt", id: attempt.id },
    },
  };
}