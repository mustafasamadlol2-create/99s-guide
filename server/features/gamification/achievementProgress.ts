import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { assertValidStudyPointsUserId } from "../study-points/validation.js";
import { GamificationError } from "./errors.js";
import { getGamificationMetricValue } from "./metrics.js";
import {
  achievementDefinitionsFor,
  uniqueAchievementMetricIds,
} from "./achievementValues.js";
import { evaluateAchievementProgress } from "./achievementEvaluation.js";
import type { AchievementProgressRow } from "./achievementEvaluation.js";
import type { GamificationRuleSetWithDefinition } from "./types.js";

type AchievementDatabase = PrismaClient;
type AchievementTransaction = Prisma.TransactionClient;
type AchievementProgressWriter = Pick<
  AchievementTransaction,
  "userAchievementProgress"
>;
const ACHIEVEMENT_LOCK_NAMESPACE = "99s-guide:gamification:achievements:";

export type AchievementProgressSnapshot = {
  ruleSetVersion: string;
  definitionChecksum: string;
  asOf: Date;
  entries: ReturnType<typeof evaluateAchievementProgress>;
};

export type AchievementProgressWriteResult = {
  created: number;
  updated: number;
};

export async function acquireUserAchievementLock(
  tx: AchievementTransaction,
  userId: string,
): Promise<void> {
  const key = `${ACHIEVEMENT_LOCK_NAMESPACE}${userId}`;
  await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT TRUE AS locked
    FROM (SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))) AS acquired
  `;
}

export async function readAchievementProgressInTransaction(input: {
  userId: string;
  database: AchievementDatabase;
  tx: AchievementTransaction;
  rules: GamificationRuleSetWithDefinition;
  asOf: Date;
  metricValueOverrides?: ReadonlyMap<string, number | boolean>;
}): Promise<AchievementProgressSnapshot> {
  const { userId, database, tx, rules, asOf, metricValueOverrides } = input;
  assertValidStudyPointsUserId(userId);
  if (!(asOf instanceof Date) || !Number.isSafeInteger(asOf.getTime())) {
    throw new GamificationError(
      "GAMIFICATION_INVALID_INPUT",
      "asOf must be a valid Date.",
    );
  }
  await acquireUserAchievementLock(tx, userId);

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

  const definitions = achievementDefinitionsFor(rules);
  const achievementIds = definitions.map(({ id }) => id);
  if (achievementIds.length === 0) {
    return {
      ruleSetVersion: rules.ruleSet.version,
      definitionChecksum: rules.ruleSet.definitionChecksum,
      asOf: new Date(asOf.getTime()),
      entries: [],
    };
  }

  const metricValues = new Map<string, number | boolean>();
  for (const metricId of uniqueAchievementMetricIds(definitions)) {
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
      select: { achievementId: true },
    }),
  ]);

  return {
    ruleSetVersion: rules.ruleSet.version,
    definitionChecksum: rules.ruleSet.definitionChecksum,
    asOf: new Date(asOf.getTime()),
    entries: evaluateAchievementProgress({
      ruleSetVersion: rules.ruleSet.version,
      definitions,
      metricValues,
      existingProgress: existingProgress as AchievementProgressRow[],
      unlockedAchievementIds: new Set(existingUnlocks.map(({ achievementId }) => achievementId)),
    }),
  };
}

/**
 * Writes only the recomputable UserAchievementProgress projection.
 * Permanent UserAchievement unlock rows are outside this writer's type and
 * are never created, updated, or deleted here.
 */
export async function persistAchievementProgressInTransaction(input: {
  tx: AchievementProgressWriter;
  userId: string;
  snapshot: AchievementProgressSnapshot;
}): Promise<AchievementProgressWriteResult> {
  assertValidStudyPointsUserId(input.userId);
  const { tx, userId, snapshot } = input;
  const missing = snapshot.entries.filter(({ progressStatus }) => progressStatus === "MISSING");
  const drifted = snapshot.entries.filter(({ progressStatus }) => progressStatus === "DRIFT");
  let created = 0;

  if (missing.length > 0) {
    const result = await tx.userAchievementProgress.createMany({
      data: missing.map(({ definition, current, target, completed }) => ({
        userId,
        achievementId: definition.id,
        ruleSetVersion: snapshot.ruleSetVersion,
        metricId: definition.metricId,
        valueType: current.valueType,
        currentValue: current.value,
        targetValue: target.value,
        completed,
        lastEvaluatedAt: snapshot.asOf,
        createdAt: snapshot.asOf,
        updatedAt: snapshot.asOf,
      })),
      skipDuplicates: true,
    });
    created = result.count;
  }

  for (const entry of drifted) {
    if (!entry.existing) continue;
    await tx.userAchievementProgress.update({
      where: { id: entry.existing.id },
      data: {
        metricId: entry.definition.metricId,
        valueType: entry.current.valueType,
        currentValue: entry.current.value,
        targetValue: entry.target.value,
        completed: entry.completed,
        lastEvaluatedAt: snapshot.asOf,
      },
    });
  }

  return { created, updated: drifted.length };
}