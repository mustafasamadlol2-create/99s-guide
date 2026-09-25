import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { assertValidStudyPointsUserId } from "../study-points/validation.js";
import { getGamificationMetricDefinition } from "./metricRegistry.js";
import { isGamificationThresholdMet } from "./thresholds.js";
import { GamificationError } from "./errors.js";
import { getGamificationMetricValue } from "./metrics.js";
import {
  acquireActiveGamificationRuleSetLock,
  getActiveGamificationRuleSet,
} from "./ruleSetService.js";
import {
  achievementDefinitionsFor,
  encodeMetricValue,
  uniqueAchievementMetricIds,
} from "./achievementValues.js";
import type { AchievementRefreshResult } from "./achievementTypes.js";
import type { GamificationRuleSetWithDefinition } from "./types.js";

type AchievementDatabase = PrismaClient;
type AchievementTransaction = Prisma.TransactionClient;
const ACHIEVEMENT_LOCK_NAMESPACE = "99s-guide:gamification:achievements:";

async function acquireUserAchievementLock(
  tx: AchievementTransaction,
  userId: string,
): Promise<void> {
  const key = `${ACHIEVEMENT_LOCK_NAMESPACE}${userId}`;
  await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT TRUE AS locked
    FROM (SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))) AS acquired
  `;
}

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
  const { userId, database, tx, rules, asOf, metricValueOverrides } = input;
  assertValidStudyPointsUserId(userId);
  await acquireUserAchievementLock(tx, userId);
  const definitions = achievementDefinitionsFor(rules);
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) {
    throw new GamificationError(
      "GAMIFICATION_USER_NOT_FOUND",
      "The authenticated user does not exist.",
    );
  }

  const metricIds = uniqueAchievementMetricIds(definitions);
  const metricValues = new Map<string, number | boolean>();
  for (const metricId of metricIds) {
    if (metricValueOverrides?.has(metricId)) {
      metricValues.set(metricId, metricValueOverrides.get(metricId)!);
      continue;
    }
    const metric = await getGamificationMetricValue(
      { userId, metricId, asOf },
      database,
      tx,
    );
    metricValues.set(metricId, metric.value);
  }

  const achievementIds = definitions.map(({ id }) => id);
  if (achievementIds.length === 0) {
    return {
      ruleSetVersion: rules.ruleSet.version,
      asOf,
      achievementCount: 0,
      newlyUnlockedCount: 0,
    };
  }
  const [existingProgress, existingUnlocks] = await Promise.all([
    tx.userAchievementProgress.findMany({
      where: {
        userId,
        ruleSetVersion: rules.ruleSet.version,
        achievementId: { in: achievementIds },
      },
    }),
    tx.userAchievement.findMany({
      where: { userId, achievementId: { in: achievementIds } },
    }),
  ]);
  const progressByAchievement = new Map(
    existingProgress.map((row) => [row.achievementId, row]),
  );
  const unlockedIds = new Set(existingUnlocks.map((row) => row.achievementId));
  const evaluations = definitions.map((definition) => {
    const metricDefinition = getGamificationMetricDefinition(definition.metricId);
    const rawValue = metricValues.get(definition.metricId);
    if (rawValue === undefined) {
      throw new GamificationError(
        "GAMIFICATION_METRIC_VALUE_INVALID",
        `Metric ${definition.metricId} was not evaluated.`,
      );
    }
    const current = encodeMetricValue(
      rawValue,
      metricDefinition.valueType,
      definition.id,
    );
    const target = encodeMetricValue(
      definition.threshold,
      metricDefinition.valueType,
      definition.id,
    );
    const completed = isGamificationThresholdMet(rawValue, definition.threshold);
    const existing = progressByAchievement.get(definition.id);
    return {
      definition,
      current,
      target,
      completed,
      existing,
      needsUnlock: completed && !unlockedIds.has(definition.id),
    };
  });

  const unlocksToCreate = evaluations
    .filter((evaluation) => evaluation.needsUnlock)
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

  const progressToCreate = evaluations
    .filter(({ existing }) => !existing)
    .map(({ definition, current, target, completed }) => ({
      userId,
      achievementId: definition.id,
      ruleSetVersion: rules.ruleSet.version,
      metricId: definition.metricId,
      valueType: current.valueType,
      currentValue: current.value,
      targetValue: target.value,
      completed,
      lastEvaluatedAt: asOf,
      createdAt: asOf,
      updatedAt: asOf,
    }));
  if (progressToCreate.length > 0) {
    await tx.userAchievementProgress.createMany({
      data: progressToCreate,
      skipDuplicates: true,
    });
  }

  for (const { existing, definition, current, target, completed } of evaluations) {
    if (!existing) continue;
    const changed = existing.currentValue !== current.value
      || existing.metricId !== definition.metricId
      || existing.valueType !== current.valueType
      || existing.targetValue !== target.value
      || existing.completed !== completed;
    if (!changed) continue;
    await tx.userAchievementProgress.update({
      where: { id: existing.id },
      data: {
        metricId: definition.metricId,
        valueType: current.valueType,
        currentValue: current.value,
        targetValue: target.value,
        completed,
        lastEvaluatedAt: asOf,
      },
    });
  }

  return {
    ruleSetVersion: rules.ruleSet.version,
    asOf,
    achievementCount: definitions.length,
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