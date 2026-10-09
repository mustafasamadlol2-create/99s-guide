import type { PrismaClient } from "@prisma/client";
import { reconcileStudyPointsAccount } from "../../features/study-points/reconciliation.js";
import {
  backfillStudyPointsLegacyBatch,
  getStudyPointsLegacyImportAudit,
} from "../../features/study-points/legacyBackfill.js";
import type {
  StudyPointsLegacyBackfillBatchResult,
  StudyPointsLegacyImportAudit,
} from "../../features/study-points/legacyBackfill.js";
import type { InspectionResult, MaintenanceAdapter } from "../core/index.js";
import { userDiscoverer, type UserMaintenanceItem } from "./types.js";

type PointsService = typeof reconcileStudyPointsAccount;

export type PointsMaintenanceDependencies = {
  database: Pick<PrismaClient, "user">;
  reconcile?: PointsService;
};

function result(value: Awaited<ReturnType<PointsService>>): InspectionResult {
  const changed = value.status !== "IN_SYNC";
  return {
    status: value.status,
    wouldChange: changed,
    changed: value.repaired === true,
    code: value.anomalyCodes[0],
  };
}

export function createPointsAdapter({
  database,
  reconcile = reconcileStudyPointsAccount,
}: PointsMaintenanceDependencies): MaintenanceAdapter<UserMaintenanceItem> {
  return {
    discoverBatch: userDiscoverer(database),
    async inspect(item) {
      return result(await reconcile({ userId: item.id, repairProjection: false }));
    },
    async apply(item) {
      return result(await reconcile({ userId: item.id, repairProjection: true }));
    },
  };
}

type LegacyAuditService = typeof getStudyPointsLegacyImportAudit;
type LegacyBackfillService = typeof backfillStudyPointsLegacyBatch;

export type LegacyPointsBackfillDependencies = {
  database: PrismaClient;
  audit?: LegacyAuditService;
  backfill?: LegacyBackfillService;
};

function legacyImportResult(
  audit: StudyPointsLegacyImportAudit,
  changed: boolean,
): InspectionResult {
  const code = !audit.userExists
    ? "POINTS_USER_NOT_FOUND"
    : audit.complete
      ? undefined
      : !audit.markerExists
        ? "LEGACY_CUTOVER_NOT_STARTED"
        : audit.sourceSnapshotMatches
          ? "LEGACY_IMPORT_INCOMPLETE"
          : "LEGACY_SOURCE_CHANGED";
  return {
    status: audit.complete ? "LEGACY_IMPORT_COMPLETE" : "LEGACY_IMPORT_INCOMPLETE",
    wouldChange: !audit.complete,
    changed,
    ...(code ? { code } : {}),
  };
}

export function createLegacyPointsBackfillAdapter({
  database,
  audit = getStudyPointsLegacyImportAudit,
  backfill = backfillStudyPointsLegacyBatch,
}: LegacyPointsBackfillDependencies): MaintenanceAdapter<UserMaintenanceItem> {
  return {
    discoverBatch: userDiscoverer(database),
    async inspect(item) {
      return legacyImportResult(await audit(item.id, database), false);
    },
    async apply(item) {
      const before = await audit(item.id, database);
      let remainingPointLogRows: number;
      let importedLedgerEntries = 0;
      let iterations = 0;
      do {
        const batch = await backfill({ userId: item.id }, database);
        importedLedgerEntries += batch.importedLedgerEntries;
        remainingPointLogRows = batch.remainingPointLogRows;
        iterations += 1;
        if (remainingPointLogRows !== 0 && iterations >= 100_000) {
          throw new Error("Legacy Study Points import exceeded the safety batch limit.");
        }
      } while (remainingPointLogRows !== 0);
      const after = await audit(item.id, database);
      return legacyImportResult(
        after,
        importedLedgerEntries > 0
          || !before.markerExists
          || before.markerStatus !== after.markerStatus,
      );
    },
  };
}