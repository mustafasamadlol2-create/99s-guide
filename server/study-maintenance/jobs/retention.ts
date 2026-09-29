import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { reconcileLectureRetention, type LectureRetentionReconciliation } from "../../features/mastery/retentionReconciliation.js";
import type { MaintenanceAdapter, InspectionResult } from "../core/types.js";
import { createMasteryCandidateSource, type MasteryCandidateSource, type MasteryMaintenanceItem } from "./mastery.js";
import { parseMaintenanceScope, type MaintenanceScope } from "./scope.js";

export type RetentionMaintenanceItem = MasteryMaintenanceItem;
export type RetentionCandidateSource = MasteryCandidateSource;
export type RetentionReconciler = (input: {
  userId: string;
  lectureId: string;
  repair: boolean;
  asOf: Date;
  database?: PrismaClient;
}) => Promise<LectureRetentionReconciliation>;

function result(reconciliation: LectureRetentionReconciliation, repair: boolean): InspectionResult {
  return {
    status: reconciliation.status,
    changed: repair && reconciliation.repaired,
    wouldChange: !repair && reconciliation.status !== "IN_SYNC",
    skipped: false,
    code: reconciliation.status,
  };
}

export function createRetentionMaintenanceAdapter(input: {
  database?: PrismaClient;
  candidateSource?: RetentionCandidateSource;
  reconcile?: RetentionReconciler;
} = {}): MaintenanceAdapter<RetentionMaintenanceItem> {
  const database = input.database ?? getPrisma() as PrismaClient;
  const source = input.candidateSource ?? createMasteryCandidateSource(database);
  const reconcile = input.reconcile ?? ((args) => reconcileLectureRetention({ ...args, database }));
  return {
    async discoverBatch({ cursor, limit, scope }) {
      const parsed = parseMaintenanceScope(scope);
      return source.listCandidates({ cursor, limit, scope: parsed });
    },
    async inspect(item, { asOf }) {
      return result(await reconcile({ userId: item.userId, lectureId: item.lectureId, repair: false, asOf: new Date(asOf), database }), false);
    },
    async apply(item, { asOf }) {
      return result(await reconcile({ userId: item.userId, lectureId: item.lectureId, repair: true, asOf: new Date(asOf), database }), true);
    },
  };
}