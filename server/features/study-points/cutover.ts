import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { reconcileStudyPointsAccount } from "./reconciliation.js";

export type StudyPointsCutoverReadiness = {
  userId: string;
  legacyRowCount: number;
  legacyPoints: number;
  ledgerEntryCount: number;
  ledgerPoints: number;
  legacyBaselinePresent: boolean;
  safeForLedgerOnly: boolean;
  blockers: string[];
};

export async function getStudyPointsCutoverReadiness(
  userId: string,
  database: PrismaClient = getPrisma() as PrismaClient,
): Promise<StudyPointsCutoverReadiness> {
  const [reconciliation, baselines] = await Promise.all([
    reconcileStudyPointsAccount({ userId }, database),
    database.studyPointsLedgerEntry.findMany({
      where: {
        userId,
        sourceType: "LEGACY_POINTS_LOG",
        reasonCode: "legacy.baseline_import",
      },
      select: { amount: true },
    }),
  ]);
  const blockers = new Set<string>();
  if (reconciliation.legacy.points !== 0 && baselines.length === 0) {
    blockers.add("UNMIGRATED_LEGACY_POINTS");
  }
  if (baselines.length > 0) {
    blockers.add("UNSUPPORTED_LEGACY_SEMANTICS");
  }
  if (
    reconciliation.status === "PROJECTION_MISSING"
    || reconciliation.status === "PROJECTION_DRIFT"
  ) {
    blockers.add("PROJECTION_DRIFT");
  }
  if (
    reconciliation.status === "LEDGER_INVARIANT_FAILURE"
    || reconciliation.anomalyCodes.some((code) =>
      !code.startsWith("PROJECTION_"))
  ) {
    blockers.add("LEDGER_INVARIANT_FAILURE");
  }
  if (baselines.length > 1) blockers.add("DUPLICATE_LEGACY_BASELINE");
  const orderedBlockers = [...blockers].sort();
  return {
    userId,
    legacyRowCount: reconciliation.legacy.rowCount,
    legacyPoints: reconciliation.legacy.points,
    ledgerEntryCount: reconciliation.canonical.ledgerEntryCount,
    ledgerPoints: reconciliation.canonical.totalPoints,
    legacyBaselinePresent: baselines.length > 0,
    safeForLedgerOnly: orderedBlockers.length === 0,
    blockers: orderedBlockers,
  };
}