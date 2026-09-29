import type { PrismaClient } from "@prisma/client";
import {
  reconcileUserGamificationLevel,
  refreshUserGamificationLevel,
} from "../../features/gamification/levelService.js";
import type { InspectionResult, MaintenanceAdapter } from "../core/index.js";
import { userDiscoverer, type UserMaintenanceItem } from "./types.js";

type LevelInspect = typeof reconcileUserGamificationLevel;
type LevelRefresh = typeof refreshUserGamificationLevel;

export type LevelMaintenanceDependencies = {
  database: Pick<PrismaClient, "user">;
  inspect?: LevelInspect;
  refresh?: LevelRefresh;
};

function inspection(value: Awaited<ReturnType<LevelInspect>>): InspectionResult {
  const changed = value.status !== "IN_SYNC";
  return { status: value.status, wouldChange: changed, code: value.status };
}

export function createLevelAdapter({
  database,
  inspect = reconcileUserGamificationLevel,
  refresh = refreshUserGamificationLevel,
}: LevelMaintenanceDependencies): MaintenanceAdapter<UserMaintenanceItem> {
  return {
    discoverBatch: userDiscoverer(database),
    async inspect(item) {
      return inspection(await inspect(item.id));
    },
    async apply(item) {
      const value = await refresh(item.id);
      return { status: value.level ? "REBUILT" : "IN_SYNC", changed: true };
    },
  };
}