import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { assertValidStudyPointsUserId } from "../study-points/validation.js";
import {
  acquireActiveGamificationRuleSetLock,
  getActiveGamificationRuleSet,
} from "./ruleSetService.js";
import {
  persistAchievementProgressInTransaction,
  readAchievementProgressInTransaction,
  type AchievementProgressSnapshot,
} from "./achievementProgress.js";

export type AchievementProgressMaintenanceResult = {
  snapshot: AchievementProgressSnapshot;
  created: number;
  updated: number;
};

async function runAchievementProgressMaintenance(input: {
  userId: string;
  asOf: Date;
  database: PrismaClient;
  repairProgress: boolean;
}): Promise<AchievementProgressMaintenanceResult> {
  assertValidStudyPointsUserId(input.userId);
  return input.database.$transaction(async (tx) => {
    await acquireActiveGamificationRuleSetLock(tx);
    const rules = await getActiveGamificationRuleSet(tx);
    const snapshot = await readAchievementProgressInTransaction({
      userId: input.userId,
      database: input.database,
      tx,
      rules,
      asOf: input.asOf,
    });
    const writes = input.repairProgress
      ? await persistAchievementProgressInTransaction({
        tx,
        userId: input.userId,
        snapshot,
      })
      : { created: 0, updated: 0 };
    return { snapshot, ...writes };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5_000,
    timeout: 20_000,
  });
}

export function auditAchievementProgressForMaintenance(input: {
  userId: string;
  asOf: Date;
  database?: PrismaClient;
}): Promise<AchievementProgressMaintenanceResult> {
  return runAchievementProgressMaintenance({
    ...input,
    database: input.database ?? getPrisma() as PrismaClient,
    repairProgress: false,
  });
}

export function rebuildAchievementProgressForMaintenance(input: {
  userId: string;
  asOf: Date;
  database?: PrismaClient;
}): Promise<AchievementProgressMaintenanceResult> {
  return runAchievementProgressMaintenance({
    ...input,
    database: input.database ?? getPrisma() as PrismaClient,
    repairProgress: true,
  });
}