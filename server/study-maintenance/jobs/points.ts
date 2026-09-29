import type { PrismaClient } from "@prisma/client";
import { reconcileStudyPointsAccount } from "../../features/study-points/reconciliation.js";
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