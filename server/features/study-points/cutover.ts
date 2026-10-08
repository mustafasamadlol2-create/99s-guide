import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { reconcileStudyPointsAccount } from "./reconciliation.js";
import { getStudyPointsLegacyImportAudit } from "./legacyBackfill.js";

export type StudyPointsCutoverReadiness = {
  userId: string;
  legacyRowCount: number;
  legacyPoints: number;
  legacyUserPoints: number;
  missingLegacyRows: number;
  importedLegacyRows: number;
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
  const [reconciliation, legacyAudit] = await Promise.all([
    reconcileStudyPointsAccount({ userId }, database),
    getStudyPointsLegacyImportAudit(userId, database),
  ]);
  const blockers = new Set<string>();
  const requiresLegacyImport = legacyAudit.legacyUserPoints !== 0
    || legacyAudit.pointsLogRowCount > 0;
  if (legacyAudit.unsupportedBaselineRows > 0) {
    blockers.add("UNSUPPORTED_LEGACY_SEMANTICS");
  }
  if (requiresLegacyImport && !legacyAudit.markerExists) {
    blockers.add("LEGACY_CUTOVER_NOT_STARTED");
  }
  if (
    legacyAudit.markerExists
    && legacyAudit.markerStatus !== "COMPLETED"
  ) {
    blockers.add("LEGACY_CUTOVER_INCOMPLETE");
  }
  if (legacyAudit.markerExists && !legacyAudit.complete) {
    blockers.add("LEGACY_IMPORT_INCOMPLETE");
  }
  if (legacyAudit.markerExists && !legacyAudit.sourceSnapshotMatches) {
    blockers.add("LEGACY_SOURCE_CHANGED");
  }
  if (legacyAudit.missingPointLogRows > 0) {
    blockers.add("UNMIGRATED_LEGACY_POINTS");
  }
  if (legacyAudit.invalidPointLogRows > 0) {
    blockers.add("LEGACY_IMPORT_MISMATCH");
  }
  if (legacyAudit.orphanPointLogImports > 0) {
    blockers.add("ORPHAN_LEGACY_IMPORT");
  }
  if (
    legacyAudit.invalidAdjustmentRows > 0
    || legacyAudit.importedAdjustment !== legacyAudit.legacyAdjustment
    || legacyAudit.unsupportedLegacyRows > 0
  ) {
    blockers.add("LEGACY_IMPORT_MISMATCH");
  }
  if (
    reconciliation.status === "PROJECTION_DRIFT"
    || (
      reconciliation.status === "PROJECTION_MISSING"
      && reconciliation.canonical.ledgerEntryCount > 0
    )
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
  const orderedBlockers = [...blockers].sort();
  return {
    userId,
    legacyRowCount: reconciliation.legacy.rowCount,
    legacyPoints: reconciliation.legacy.points,
    legacyUserPoints: legacyAudit.legacyUserPoints,
    missingLegacyRows: legacyAudit.missingPointLogRows,
    importedLegacyRows: legacyAudit.importedPointLogRows,
    ledgerEntryCount: reconciliation.canonical.ledgerEntryCount,
    ledgerPoints: reconciliation.canonical.totalPoints,
    legacyBaselinePresent: legacyAudit.unsupportedBaselineRows > 0,
    safeForLedgerOnly: orderedBlockers.length === 0,
    blockers: orderedBlockers,
  };
}