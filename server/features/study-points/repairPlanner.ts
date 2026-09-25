import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { assertValidStudyPointsUserId } from "./validation.js";

export type StudyPointsAccountingRepairPlan = {
  action: "REVERSE_ENTRY" | "REPLAY_SOURCE_AWARD" | "MANUAL_REVIEW_REQUIRED";
  anomalyCode: string;
  entryId?: string;
  note: string;
  requiresExplicitOperation: true;
};

/**
 * Produces a recommendation only. Ledger mutations remain exclusively in the
 * existing append/reversal service and require a separate explicit operation.
 */
export async function planStudyPointsAccountingRepair(input: {
  userId: string;
  anomalyCode: string;
  entryId?: string;
}, database: PrismaClient = getPrisma() as PrismaClient): Promise<StudyPointsAccountingRepairPlan> {
  assertValidStudyPointsUserId(input.userId);
  if (
    input.anomalyCode !== "DUPLICATE_SOURCE_AWARD"
    || typeof input.entryId !== "string"
    || input.entryId.length < 1
    || input.entryId.length > 128
    || input.entryId.includes("\0")
  ) {
    return {
      action: "MANUAL_REVIEW_REQUIRED",
      anomalyCode: input.anomalyCode,
      note: "Available evidence does not identify a safe canonical correction.",
      requiresExplicitOperation: true,
    };
  }

  return database.$transaction(async (tx) => {
    const candidate = await tx.studyPointsLedgerEntry.findFirst({
      where: { id: input.entryId, userId: input.userId },
      select: {
        id: true,
        amount: true,
        category: true,
        sourceType: true,
        sourceId: true,
        reasonCode: true,
        ruleVersion: true,
        reversalOfEntryId: true,
      },
    });
    if (
      !candidate
      || candidate.amount <= 0
      || !candidate.sourceId
      || candidate.sourceType === "REVERSAL"
      || candidate.sourceType === "LEGACY_POINTS_LOG"
      || candidate.sourceType === "ADMIN_ADJUSTMENT"
      || candidate.reversalOfEntryId !== null
    ) {
      return {
        action: "MANUAL_REVIEW_REQUIRED",
        anomalyCode: input.anomalyCode,
        note: "The selected row is not a reversible positive source award.",
        requiresExplicitOperation: true as const,
      };
    }

    const duplicateCount = await tx.studyPointsLedgerEntry.count({
      where: {
        userId: input.userId,
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId,
        reasonCode: candidate.reasonCode,
        ruleVersion: candidate.ruleVersion,
        amount: { gt: 0 },
      },
    });
    if (duplicateCount < 2) {
      return {
        action: "MANUAL_REVIEW_REQUIRED",
        anomalyCode: input.anomalyCode,
        note: "The duplicate-source condition is not present in the canonical ledger snapshot.",
        requiresExplicitOperation: true as const,
      };
    }
    const existingReversal = await tx.studyPointsLedgerEntry.findUnique({
      where: { reversalOfEntryId: candidate.id },
      select: { id: true },
    });
    if (existingReversal) {
      return {
        action: "MANUAL_REVIEW_REQUIRED",
        anomalyCode: input.anomalyCode,
        note: "The selected award already has a reversal.",
        requiresExplicitOperation: true as const,
      };
    }
    return {
      action: "REVERSE_ENTRY",
      anomalyCode: input.anomalyCode,
      entryId: candidate.id,
      note: "A duplicate positive source award exists; an authorized operator must confirm and invoke the canonical reversal operation.",
      requiresExplicitOperation: true as const,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}