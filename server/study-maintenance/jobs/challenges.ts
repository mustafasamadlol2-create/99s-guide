import type { PrismaClient } from "@prisma/client";
import { reconcileUserChallenges } from "../../features/gamification/challengeReconciliation.js";
import type { InspectionResult, MaintenanceAdapter } from "../core/index.js";
import { userDiscoverer, type UserMaintenanceItem } from "./types.js";

type ChallengeService = typeof reconcileUserChallenges;

export type ChallengeMaintenanceDependencies = {
  database: Pick<PrismaClient, "user">;
  reconcile?: ChallengeService;
};

function result(value: Awaited<ReturnType<ChallengeService>>, applying: boolean): InspectionResult {
  const changed = value.checks.length > 0;
  return {
    status: changed ? "DRIFT" : "IN_SYNC",
    wouldChange: changed,
    changed: applying && value.repaired,
    code: value.checks[0]?.status,
  };
}

export function createChallengeAdapter({
  database,
  reconcile = reconcileUserChallenges,
}: ChallengeMaintenanceDependencies): MaintenanceAdapter<UserMaintenanceItem> {
  return {
    discoverBatch: userDiscoverer(database),
    async inspect(item, input) {
      return result(await reconcile({
        userId: item.id,
        repair: false,
        asOf: new Date(input.asOf),
      }), false);
    },
    async apply(item, input) {
      return result(await reconcile({
        userId: item.id,
        repair: true,
        asOf: new Date(input.asOf),
      }), true);
    },
  };
}