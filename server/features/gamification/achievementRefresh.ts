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
} from "./achievementProgress.js";
import type { AchievementRefreshResult } from "./achievementTypes.js";
import type { GamificationRuleSetWithDefinition } from "./types.js";

type AchievementDatabase = PrismaClient;
type AchievementTransaction = Prisma.TransactionClient;

export async function refreshUserAchievementProgress(
  userId: string,
  database: AchievementDatabase = getPrisma() as PrismaClient,
): Promise<AchievementRefreshResult> {
  assertValidStudyPointsUserId(userId);
  return database.$transaction(async (tx) => {
    await acquireActiveGamificationRuleSetLock(tx);
    const rules = await getActiveGamificationRuleSet(tx);
    const [{ now: asOf }] = await tx.$queryRaw<Array<{ now: Date }>>`
      SELECT CURRENT_TIMESTAMP AS now
    `;
    return refreshUserAchievementProgressInTransaction({
      userId,
      database,
      tx,
      rules,
      asOf,
    });
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5_000,
    timeout: 20_000,
  });
}

export async function refreshUserAchievementProgressInTransaction(input: {
  userId: string;
  database: AchievementDatabase;
  tx: AchievementTransaction;
  rules: GamificationRuleSetWithDefinition;
  asOf: Date;
  metricValueOverrides?: ReadonlyMap<string, number | boolean>;
}): Promise<AchievementRefreshResult> {
  const { userId, tx, rules, asOf } = input;
  const snapshot = await readAchievementProgressInTransaction(input);
  const unlocksToCreate = snapshot.entries
    .filter(({ completed, unlocked }) => completed && !unlocked)
    .map(({ definition, current, target }) => ({
      userId,
      achievementId: definition.id,
      unlockedUnderRuleSetVersion: rules.ruleSet.version,
      metricId: definition.metricId,
      valueType: current.valueType,
      metricValueAtUnlock: current.value,
      targetValueAtUnlock: target.value,
      definitionChecksumAtUnlock: rules.ruleSet.definitionChecksum,
      unlockedAt: asOf,
      createdAt: asOf,
    }));
  let newlyUnlockedCount = 0;
  if (unlocksToCreate.length > 0) {
    const createdUnlocks = await tx.userAchievement.createMany({
      data: unlocksToCreate,
      skipDuplicates: true,
    });
    newlyUnlockedCount = createdUnlocks.count;
  }

  await persistAchievementProgressInTransaction({
    tx,
    userId,
    snapshot,
  });

  return {
    ruleSetVersion: rules.ruleSet.version,
    asOf,
    achievementCount: snapshot.entries.length,
    newlyUnlockedCount,
  };
}

/**
 * Deterministic repair updates only active progress and missing active
 * unlocks. It never removes old progress or permanent unlock history.
 */
export async function reconcileUserAchievementState(
  userId: string,
  database: AchievementDatabase = getPrisma() as PrismaClient,
): Promise<AchievementRefreshResult> {
  return refreshUserAchievementProgress(userId, database);
}

export async function refreshUserAchievementsBestEffort(
  userId: string,
  database: AchievementDatabase = getPrisma() as PrismaClient,
): Promise<void> {
  try {
    await refreshUserAchievementProgress(userId, database);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    console.warn(`[Achievements] Post-commit refresh failed: ${reason}`);
  }
}