import type { PrismaClient } from "@prisma/client";
import { reconcileMasteryD1Projection } from "../../features/mastery/d1Reconciliation.js";
import type { MaintenanceAdapter, InspectionResult } from "../core/types.js";
import { userDiscoverer, type UserMaintenanceItem } from "./types.js";

export type PrivateD1Reconciler = typeof reconcileMasteryD1Projection;

function result(
  report: Awaited<ReturnType<PrivateD1Reconciler>>,
  applying: boolean,
): InspectionResult {
  const unavailable = !report.d1.available
    || report.statuses.some(({ codes }) => codes.includes("D1_SCHEMA_MISMATCH"));
  const hasDrift = report.statuses.length > 0;
  return {
    status: unavailable ? "D1_UNAVAILABLE" : hasDrift ? "DRIFT" : "IN_SYNC",
    skipped: unavailable && !applying,
    wouldChange: !applying && hasDrift && !unavailable,
    changed: applying && report.repaired > 0,
    code: report.statuses.flatMap(({ codes }) => codes).sort()[0],
  };
}

export function createPrivateD1Adapter(input: {
  database: Pick<PrismaClient, "user">;
  lectureId?: string;
  reconcile?: PrivateD1Reconciler;
}): MaintenanceAdapter<UserMaintenanceItem> {
  const reconcile = input.reconcile ?? reconcileMasteryD1Projection;
  return {
    discoverBatch: userDiscoverer(input.database),
    async inspect(item) {
      return result(await reconcile({
        userId: item.id,
        ...(input.lectureId ? { lectureId: input.lectureId } : {}),
        repair: false,
      }), false);
    },
    async apply(item) {
      return result(await reconcile({
        userId: item.id,
        ...(input.lectureId ? { lectureId: input.lectureId } : {}),
        repair: true,
      }), true);
    },
  };
}