import {
  Prisma,
  type PrismaClient,
  type UserGamificationLevel,
} from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { getStudyPointsReadModel } from "../study-points/readModel.js";
import { assertValidStudyPointsUserId } from "../study-points/validation.js";
import { GamificationError } from "./errors.js";
import { evaluateLifetimeLevel, readGamificationLevelView } from "./levelMath.js";
import type {
  GamificationLevelReconciliation,
  GamificationLevelView,
} from "./levelTypes.js";
import {
  acquireActiveGamificationRuleSetLock,
  getActiveGamificationRuleSet,
} from "./ruleSetService.js";
import { assertGamificationLevelDefinitionsChecksum } from "./levelChecksum.js";
import type { GamificationRuleSetWithDefinition } from "./types.js";

type LevelDatabase = PrismaClient;
type LevelTransaction = Prisma.TransactionClient;

const LEVEL_LOCK_NAMESPACE = "99s-guide:gamification:levels:";

export async function acquireUserGamificationLevelLock(
  tx: LevelTransaction,
  userId: string,
): Promise<void> {
  const key = `${LEVEL_LOCK_NAMESPACE}${userId}`;
  await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT TRUE AS locked
    FROM (SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))) AS acquired
  `;
}

export async function refreshUserGamificationLevelInTransaction(
  tx: LevelTransaction,
  userId: string,
  rules: GamificationRuleSetWithDefinition,
  lifetimePoints: number,
  asOf: Date,
): Promise<UserGamificationLevel> {
  const evaluated = evaluateLifetimeLevel(
    lifetimePoints,
    rules.definitions.levelDefinitions,
  );
  const levelDefinitionChecksum = assertGamificationLevelDefinitionsChecksum(
    rules.definitions,
    rules.ruleSet.levelDefinitionChecksum,
  );
  const existing = await tx.userGamificationLevel.findUnique({
    where: { userId },
  });
  const nextState = {
    ruleSetVersion: rules.ruleSet.version,
    definitionChecksum: rules.ruleSet.definitionChecksum,
    levelDefinitionChecksum,
    level: evaluated.definition.level,
    lifetimePoints: BigInt(lifetimePoints),
    maxLevelReached: evaluated.maxLevelReached,
  };
  if (!existing) {
    return tx.userGamificationLevel.create({
      data: {
        userId,
        ...nextState,
        lastEvaluatedAt: asOf,
        createdAt: asOf,
        updatedAt: asOf,
      },
    });
  }
  const changed = existing.ruleSetVersion !== nextState.ruleSetVersion
    || existing.definitionChecksum !== nextState.definitionChecksum
    || existing.levelDefinitionChecksum !== nextState.levelDefinitionChecksum
    || existing.level !== nextState.level
    || existing.lifetimePoints !== nextState.lifetimePoints
    || existing.maxLevelReached !== nextState.maxLevelReached;
  if (!changed) return existing;
  return tx.userGamificationLevel.update({
    where: { id: existing.id },
    data: {
      ...nextState,
      lastEvaluatedAt: asOf,
    },
  });
}

async function databaseNow(tx: LevelTransaction): Promise<Date> {
  const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`
    SELECT CURRENT_TIMESTAMP AS now
  `;
  return now;
}

async function requireUser(
  tx: LevelTransaction,
  userId: string,
): Promise<void> {
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
}

export type RefreshedUserGamificationLevel = {
  rules: GamificationRuleSetWithDefinition;
  row: UserGamificationLevel;
  level: GamificationLevelView;
  points: Awaited<ReturnType<typeof getStudyPointsReadModel>>;
};

export async function refreshUserGamificationLevel(
  userId: string,
  database: LevelDatabase = getPrisma() as LevelDatabase,
): Promise<RefreshedUserGamificationLevel> {
  assertValidStudyPointsUserId(userId);
  return database.$transaction(async (tx) => {
    await acquireActiveGamificationRuleSetLock(tx);
    await acquireUserGamificationLevelLock(tx, userId);
    const rules = await getActiveGamificationRuleSet(tx);
    await requireUser(tx, userId);
    const points = await getStudyPointsReadModel({ userId }, database);
    const row = await refreshUserGamificationLevelInTransaction(
      tx,
      userId,
      rules,
      points.totalPoints,
      await databaseNow(tx),
    );
    const level = readGamificationLevelView(row, rules);
    if (!level) {
      throw new GamificationError(
        "GAMIFICATION_LEVEL_STATE_INVALID",
        "The refreshed Level projection failed source-definition validation.",
      );
    }
    return { rules, row, level, points };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5_000,
    timeout: 20_000,
  });
}

export async function reconcileUserGamificationLevel(
  userId: string,
  database: LevelDatabase = getPrisma() as LevelDatabase,
): Promise<GamificationLevelReconciliation> {
  assertValidStudyPointsUserId(userId);
  const rules = await getActiveGamificationRuleSet(database);
  const row = await database.userGamificationLevel.findUnique({
    where: { userId },
  });
  if (!row) {
    return {
      status: "LEVEL_STATE_MISSING",
      expectedLevel: null,
      storedLevel: null,
      expectedLifetimePoints: null,
      storedLifetimePoints: null,
      ruleSetVersion: rules.ruleSet.version,
    };
  }
  if (
    row.ruleSetVersion !== rules.ruleSet.version
    || row.definitionChecksum !== rules.ruleSet.definitionChecksum
    || row.levelDefinitionChecksum !== rules.ruleSet.levelDefinitionChecksum
  ) {
    return {
      status: "RULE_VERSION_STALE",
      expectedLevel: null,
      storedLevel: row.level,
      expectedLifetimePoints: null,
      storedLifetimePoints: safeStoredLifetimePoints(row.lifetimePoints),
      ruleSetVersion: rules.ruleSet.version,
    };
  }
  const storedView = readGamificationLevelView(row, rules);
  const storedLifetimePoints = safeStoredLifetimePoints(row.lifetimePoints);
  if (!storedView || storedLifetimePoints === null) {
    return {
      status: "INVALID_LEVEL_STATE",
      expectedLevel: null,
      storedLevel: row.level,
      expectedLifetimePoints: null,
      storedLifetimePoints,
      ruleSetVersion: rules.ruleSet.version,
    };
  }
  const points = await getStudyPointsReadModel({ userId }, database);
  const expected = evaluateLifetimeLevel(
    points.totalPoints,
    rules.definitions.levelDefinitions,
  );
  if (
    storedLifetimePoints !== points.totalPoints
    || storedView.level !== expected.definition.level
    || storedView.maxLevelReached !== expected.maxLevelReached
  ) {
    return {
      status: "LEVEL_STATE_STALE",
      expectedLevel: expected.definition.level,
      storedLevel: storedView.level,
      expectedLifetimePoints: points.totalPoints,
      storedLifetimePoints,
      ruleSetVersion: rules.ruleSet.version,
    };
  }
  return {
    status: "IN_SYNC",
    expectedLevel: expected.definition.level,
    storedLevel: storedView.level,
    expectedLifetimePoints: points.totalPoints,
    storedLifetimePoints,
    ruleSetVersion: rules.ruleSet.version,
  };
}

export function safeStoredLifetimePoints(value: bigint): number | null {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const decoded = Number(value);
  return Number.isSafeInteger(decoded) ? decoded : null;
}

export { readGamificationLevelView };