import {
  Prisma,
  type ChallengeInstance,
  type PrismaClient,
  type UserChallengeProgress,
} from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import {
  acquireActiveGamificationRuleSetLock,
} from "./ruleSetService.js";
import { getChallengeRuleSetVersion } from "./challengeRuleSets.js";
import {
  acquireUserChallengesLock,
  assertChallengeInstanceDefinitionMatches,
  ensureChallengeInstancesInTransaction,
  refreshChallengeInstanceStatusesInTransaction,
} from "./challengeInstances.js";
import { getBaghdadWeekPeriod } from "./challengePeriods.js";
import { getChallengeMetricValueForWindow } from "./challengeMetrics.js";
import { GamificationError } from "./errors.js";
import type {
  ChallengeSummaryItem,
  MyChallengesResponse,
  UserChallengeProgressWithInstance,
  UserChallengeStatus,
} from "./challengeTypes.js";

type ChallengeDatabase = PrismaClient;
type ChallengeTransaction = Prisma.TransactionClient;

const RECENT_HISTORY_LIMIT = 8;
const SUPPORTED_CHALLENGE_METRICS = new Set([
  "focus.completed_sessions",
  "focus.verified_seconds",
  "consistency.qualifying_days",
  "group_focus.completed_runs",
]);
const PROGRESS_STATUSES = new Set(["ACTIVE", "COMPLETED", "EXPIRED", "LEFT"]);

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function assertUserId(userId: unknown): asserts userId is string {
  if (
    typeof userId !== "string"
    || userId.length === 0
    || userId.length > 128
    || userId.trim() !== userId
  ) {
    throw new GamificationError(
      "GAMIFICATION_INVALID_INPUT",
      "Authenticated user ID is invalid.",
    );
  }
}

function toSafeInteger(value: bigint, label: string): number {
  const result = Number(value);
  if (
    value < 0n
    || !Number.isSafeInteger(result)
    || BigInt(result) !== value
  ) {
    throw new GamificationError(
      "GAMIFICATION_CHALLENGE_PROGRESS_INVALID",
      `${label} is not a safe nonnegative integer.`,
    );
  }
  return result;
}

function sameDate(left: Date | null, right: Date | null): boolean {
  return left === null
    ? right === null
    : right !== null && left.getTime() === right.getTime();
}

async function databaseNow(tx: ChallengeTransaction): Promise<Date> {
  const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`
    SELECT CURRENT_TIMESTAMP AS now
  `;
  if (!isValidDate(now)) {
    throw new GamificationError(
      "GAMIFICATION_CHALLENGE_PROGRESS_INVALID",
      "Database returned an invalid Challenge evaluation time.",
    );
  }
  return now;
}

async function requireUser(tx: ChallengeTransaction, userId: string): Promise<void> {
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

export function deriveChallengeProgressStatus(input: {
  currentStatus: string;
  currentValue: number;
  targetValue: number;
  asOf: Date;
  endsAt: Date;
}): UserChallengeStatus {
  const { currentStatus, currentValue, targetValue, asOf, endsAt } = input;
  if (
    !Number.isSafeInteger(currentValue)
    || currentValue < 0
    || !Number.isSafeInteger(targetValue)
    || targetValue < 1
    || !isValidDate(asOf)
    || !isValidDate(endsAt)
  ) {
    throw new GamificationError(
      "GAMIFICATION_CHALLENGE_PROGRESS_INVALID",
      "Challenge status evaluation input is invalid.",
    );
  }
  if (currentStatus === "COMPLETED") return "COMPLETED";
  if (currentStatus === "LEFT") return "LEFT";
  if (currentValue >= targetValue) return "COMPLETED";
  if (asOf >= endsAt) return "EXPIRED";
  return "ACTIVE";
}

function assertProgressSnapshot(
  progress: UserChallengeProgress,
  instance: ChallengeInstance,
): void {
  if (
    progress.challengeInstanceId !== instance.id
    || progress.targetValue <= 0n
    || progress.metricId.length === 0
  ) {
    throw new GamificationError(
      "GAMIFICATION_CHALLENGE_PROGRESS_INVALID",
      `Challenge progress ${progress.id} has an invalid instance reference.`,
    );
  }
}

function uniqueProgressRows(
  groups: readonly UserChallengeProgressWithInstance[][],
): UserChallengeProgressWithInstance[] {
  const byId = new Map<string, UserChallengeProgressWithInstance>();
  for (const group of groups) {
    for (const row of group) byId.set(row.id, row);
  }
  return [...byId.values()];
}

async function getProgressCandidates(
  tx: ChallengeTransaction,
  userId: string,
): Promise<UserChallengeProgressWithInstance[]> {
  const active = await tx.userChallengeProgress.findMany({
    where: { userId, status: "ACTIVE" },
    include: { instance: true },
  });
  const completed = await tx.userChallengeProgress.findMany({
    where: { userId, status: "COMPLETED", completedAt: { not: null } },
    orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    take: RECENT_HISTORY_LIMIT,
    include: { instance: true },
  });
  const expired = await tx.userChallengeProgress.findMany({
    where: { userId, status: "EXPIRED", expiredAt: { not: null } },
    orderBy: [{ expiredAt: "desc" }, { id: "desc" }],
    take: RECENT_HISTORY_LIMIT,
    include: { instance: true },
  });
  const invalid = await tx.userChallengeProgress.findMany({
    where: { userId, status: { notIn: [...PROGRESS_STATUSES] } },
    include: { instance: true },
  });
  return uniqueProgressRows([active, completed, expired, invalid]);
}

async function evaluateProgress(
  tx: ChallengeTransaction,
  progress: UserChallengeProgress,
  instance: ChallengeInstance,
  asOf: Date,
  rulesCache: Map<string, Awaited<ReturnType<typeof getChallengeRuleSetVersion>>>,
  metricCache: Map<string, number>,
): Promise<void> {
  const existingRules = rulesCache.get(instance.ruleSetVersion);
  const rules = existingRules
    ?? await getChallengeRuleSetVersion(instance.ruleSetVersion, tx);
  if (!existingRules) rulesCache.set(instance.ruleSetVersion, rules);
  const definition = rules.definitions.challengeDefinitionContracts.find(
    (candidate) => candidate.id === instance.challengeDefinitionId,
  );
  if (!definition) {
    throw new GamificationError(
      "GAMIFICATION_CHALLENGE_DEFINITION_VERSION_NOT_FOUND",
      `Challenge definition ${instance.challengeDefinitionId} is missing from ${instance.ruleSetVersion}.`,
    );
  }
  const period = getBaghdadWeekPeriod(instance.startsAt);
  assertChallengeInstanceDefinitionMatches(instance, definition, period);
  assertProgressSnapshot(progress, instance);

  if (progress.status === "LEFT") return;
  const isCompleted = progress.status === "COMPLETED";
  if (isCompleted) {
    const metadataNeedsRepair =
      progress.metricId !== instance.metricId
      || progress.targetValue !== instance.targetValue
      || progress.baselineValue !== 0n;
    if (metadataNeedsRepair) {
      await tx.userChallengeProgress.update({
        where: { id: progress.id },
        data: {
          metricId: instance.metricId,
          targetValue: instance.targetValue,
          baselineValue: 0n,
          updatedAt: asOf,
        },
      });
    }
    return;
  }

  const metricKey = [
    progress.userId,
    instance.metricId,
    instance.startsAt.toISOString(),
    instance.endsAt.toISOString(),
    asOf.toISOString(),
  ].join("|");
  let metricValue = metricCache.get(metricKey);
  if (metricValue === undefined) {
    metricValue = await getChallengeMetricValueForWindow({
      userId: progress.userId,
      metricId: instance.metricId,
      startsAt: instance.startsAt,
      endsAt: instance.endsAt,
      asOf,
      tx,
    });
    metricCache.set(metricKey, metricValue);
  }

  const previousStatus = PROGRESS_STATUSES.has(progress.status)
    ? progress.status
    : "ACTIVE";
  const targetValue = toSafeInteger(instance.targetValue, "Challenge target");
  const nextStatus = deriveChallengeProgressStatus({
    currentStatus: previousStatus,
    currentValue: metricValue,
    targetValue,
    asOf,
    endsAt: instance.endsAt,
  });
  const completedAt = nextStatus === "COMPLETED"
    ? progress.completedAt ?? asOf
    : null;
  const expiredAt = nextStatus === "EXPIRED"
    ? progress.expiredAt ?? asOf
    : null;
  const currentValue = BigInt(metricValue);
  const needsWrite =
    progress.status !== nextStatus
    || progress.metricId !== instance.metricId
    || progress.targetValue !== instance.targetValue
    || progress.baselineValue !== 0n
    || progress.currentValue !== currentValue
    || !sameDate(progress.lastEvaluatedAt, asOf)
    || !sameDate(progress.completedAt, completedAt)
    || !sameDate(progress.expiredAt, expiredAt);

  if (!needsWrite) return;
  await tx.userChallengeProgress.update({
    where: { id: progress.id },
    data: {
      status: nextStatus,
      metricId: instance.metricId,
      baselineValue: 0n,
      currentValue,
      targetValue: instance.targetValue,
      lastEvaluatedAt: asOf,
      completedAt,
      expiredAt,
      updatedAt: asOf,
    },
  });
}

export type RefreshUserChallengesInput = {
  userId: string;
  asOf?: Date;
  metricIds?: readonly string[];
};

export type RefreshedUserChallenges = {
  userId: string;
  ruleSetVersion: string;
  period: ReturnType<typeof getBaghdadWeekPeriod>;
  instances: ChallengeInstance[];
  progress: UserChallengeProgressWithInstance[];
};

export async function refreshUserChallenges(
  input: RefreshUserChallengesInput,
  database: ChallengeDatabase = getPrisma(),
): Promise<RefreshedUserChallenges> {
  assertUserId(input?.userId);
  if (
    input.asOf !== undefined
    && !isValidDate(input.asOf)
  ) {
    throw new GamificationError("GAMIFICATION_INVALID_INPUT", "asOf is invalid.");
  }
  if (
    input.metricIds !== undefined
    && (
      !Array.isArray(input.metricIds)
      || input.metricIds.some((metricId) =>
        typeof metricId !== "string"
        || !SUPPORTED_CHALLENGE_METRICS.has(metricId))
    )
  ) {
    throw new GamificationError(
      "GAMIFICATION_INVALID_INPUT",
      "Challenge metric filter contains an unsupported metric.",
    );
  }
  const metricFilter = input.metricIds === undefined
    ? null
    : new Set(input.metricIds);

  return database.$transaction(async (tx) => {
    await acquireActiveGamificationRuleSetLock(tx);
    await acquireUserChallengesLock(tx, input.userId);
    const asOf = input.asOf ?? await databaseNow(tx);
    await requireUser(tx, input.userId);
    const period = getBaghdadWeekPeriod(asOf);
    const ensured = await ensureChallengeInstancesInTransaction(tx, asOf, period);
    await refreshChallengeInstanceStatusesInTransaction(tx, asOf);
    const currentInstances = ensured.instances;

    if (asOf >= period.startsAt) {
      const existing = await tx.userChallengeProgress.findMany({
        where: {
          userId: input.userId,
          challengeInstanceId: { in: currentInstances.map(({ id }) => id) },
        },
      });
      const existingInstanceIds = new Set(
        existing.map(({ challengeInstanceId }) => challengeInstanceId),
      );
      const enrollments = currentInstances
        .filter((instance) =>
          instance.enrollmentPolicy === "AUTO"
          && !existingInstanceIds.has(instance.id))
        .map((instance) => ({
          userId: input.userId,
          challengeInstanceId: instance.id,
          status: "ACTIVE",
          metricId: instance.metricId,
          baselineValue: 0n,
          currentValue: 0n,
          targetValue: instance.targetValue,
          enrolledAt: asOf,
          lastEvaluatedAt: asOf,
          createdAt: asOf,
          updatedAt: asOf,
        }));
      if (enrollments.length > 0) {
        await tx.userChallengeProgress.createMany({
          data: enrollments,
          skipDuplicates: true,
        });
      }
    }

    const candidates = await getProgressCandidates(tx, input.userId);
    const rulesCache = new Map<
      string,
      Awaited<ReturnType<typeof getChallengeRuleSetVersion>>
    >([[ensured.ruleSetVersion, await getChallengeRuleSetVersion(
      ensured.ruleSetVersion,
      tx,
    )]]);
    const metricCache = new Map<string, number>();
    for (const progress of candidates) {
      if (metricFilter && !metricFilter.has(progress.instance.metricId)) continue;
      if (progress.instance.status === "CANCELLED") continue;
      if (asOf < progress.instance.startsAt) continue;
      await evaluateProgress(
        tx,
        progress,
        progress.instance,
        asOf,
        rulesCache,
        metricCache,
      );
    }

    const currentProgress = await tx.userChallengeProgress.findMany({
      where: {
        userId: input.userId,
        challengeInstanceId: { in: currentInstances.map(({ id }) => id) },
      },
      include: { instance: true },
    });
    return {
      userId: input.userId,
      ruleSetVersion: ensured.ruleSetVersion,
      period,
      instances: currentInstances,
      progress: currentProgress,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5_000,
    timeout: 60_000,
  });
}

export async function evaluateUserChallenge(
  input: {
    userId: string;
    challengeInstanceId: string;
    asOf?: Date;
  },
  database: ChallengeDatabase = getPrisma(),
): Promise<UserChallengeProgress> {
  assertUserId(input?.userId);
  if (
    typeof input.challengeInstanceId !== "string"
    || input.challengeInstanceId.length === 0
    || input.challengeInstanceId.length > 128
  ) {
    throw new GamificationError(
      "GAMIFICATION_INVALID_INPUT",
      "Challenge instance ID is invalid.",
    );
  }
  if (input.asOf !== undefined && !isValidDate(input.asOf)) {
    throw new GamificationError("GAMIFICATION_INVALID_INPUT", "asOf is invalid.");
  }
  return database.$transaction(async (tx) => {
    await acquireUserChallengesLock(tx, input.userId);
    await requireUser(tx, input.userId);
    const asOf = input.asOf ?? await databaseNow(tx);
    const progress = await tx.userChallengeProgress.findUnique({
      where: {
        userId_challengeInstanceId: {
          userId: input.userId,
          challengeInstanceId: input.challengeInstanceId,
        },
      },
      include: { instance: true },
    });
    if (!progress) {
      throw new GamificationError(
        "GAMIFICATION_CHALLENGE_PROGRESS_MISSING",
        "User is not enrolled in this Challenge instance.",
      );
    }
    await evaluateProgress(
      tx,
      progress,
      progress.instance,
      asOf,
      new Map(),
      new Map(),
    );
    const refreshed = await tx.userChallengeProgress.findUnique({
      where: { id: progress.id },
    });
    if (!refreshed) {
      throw new GamificationError(
        "GAMIFICATION_CHALLENGE_PROGRESS_INVALID",
        "Challenge progress disappeared during evaluation.",
      );
    }
    return refreshed;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5_000,
    timeout: 30_000,
  });
}

function toSummaryItem(
  progress: UserChallengeProgressWithInstance,
): ChallengeSummaryItem {
  const currentValue = toSafeInteger(progress.currentValue, "Challenge progress");
  const targetValue = toSafeInteger(progress.targetValue, "Challenge target");
  if (
    !PROGRESS_STATUSES.has(progress.status)
    || targetValue < 1
  ) {
    throw new GamificationError(
      "GAMIFICATION_CHALLENGE_PROGRESS_INVALID",
      `Challenge progress ${progress.id} cannot be serialized.`,
    );
  }
  const current = Math.min(currentValue, targetValue);
  return {
    instanceId: progress.challengeInstanceId,
    definitionId: progress.instance.challengeDefinitionId,
    ruleSetVersion: progress.instance.ruleSetVersion,
    periodKey: progress.instance.logicalPeriodKey,
    titleKey: progress.instance.titleKey,
    descriptionKey: progress.instance.descriptionKey,
    metricId: progress.metricId,
    current,
    target: targetValue,
    progressRatio: Math.min(currentValue / targetValue, 1),
    status: progress.status as UserChallengeStatus,
    startsAt: progress.instance.startsAt,
    endsAt: progress.instance.endsAt,
    completedAt: progress.completedAt,
    expiredAt: progress.expiredAt,
  };
}

export async function getMyChallenges(
  userId: string,
  database: ChallengeDatabase = getPrisma(),
): Promise<MyChallengesResponse> {
  const refreshed = await refreshUserChallenges({ userId }, database);
  const completed = await database.userChallengeProgress.findMany({
    where: {
      userId,
      status: "COMPLETED",
      completedAt: { not: null },
    },
    orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    take: RECENT_HISTORY_LIMIT,
    include: { instance: true },
  });
  const expired = await database.userChallengeProgress.findMany({
    where: {
      userId,
      status: "EXPIRED",
      expiredAt: { not: null },
    },
    orderBy: [{ expiredAt: "desc" }, { id: "desc" }],
    take: RECENT_HISTORY_LIMIT,
    include: { instance: true },
  });
  const recent = [...completed, ...expired]
    .sort((left, right) => {
      const leftAt = left.completedAt ?? left.expiredAt!;
      const rightAt = right.completedAt ?? right.expiredAt!;
      return rightAt.getTime() - leftAt.getTime()
        || right.id.localeCompare(left.id);
    })
    .slice(0, RECENT_HISTORY_LIMIT)
    .map(toSummaryItem);
  const progressByInstance = new Map(
    refreshed.progress.map((row) => [row.challengeInstanceId, row]),
  );
  const active = refreshed.instances
    .filter((instance) =>
      instance.status === "ACTIVE" || instance.status === "UPCOMING")
    .flatMap((instance) => {
      const progress = progressByInstance.get(instance.id);
      return progress?.status === "ACTIVE" ? [toSummaryItem(progress)] : [];
    })
    .sort((left, right) => {
      const leftInstance = refreshed.instances.find(
        (instance) => instance.id === left.instanceId,
      )!;
      const rightInstance = refreshed.instances.find(
        (instance) => instance.id === right.instanceId,
      )!;
      return leftInstance.sortOrder - rightInstance.sortOrder
        || left.definitionId.localeCompare(right.definitionId);
    });
  return {
    ruleSetVersion: refreshed.ruleSetVersion,
    currentPeriod: refreshed.period,
    active,
    recent,
  };
}

export async function joinChallenge(
  input: { userId: string; challengeInstanceId: string },
  database: ChallengeDatabase = getPrisma(),
): Promise<UserChallengeProgress> {
  assertUserId(input?.userId);
  if (
    typeof input.challengeInstanceId !== "string"
    || input.challengeInstanceId.length === 0
    || input.challengeInstanceId.length > 128
  ) {
    throw new GamificationError(
      "GAMIFICATION_INVALID_INPUT",
      "Challenge instance ID is invalid.",
    );
  }
  return database.$transaction(async (tx) => {
    await acquireUserChallengesLock(tx, input.userId);
    await requireUser(tx, input.userId);
    const instance = await tx.challengeInstance.findUnique({
      where: { id: input.challengeInstanceId },
    });
    if (!instance) {
      throw new GamificationError(
        "GAMIFICATION_CHALLENGE_INSTANCE_INVALID",
        "Challenge instance was not found.",
      );
    }
    const now = await databaseNow(tx);
    if (
      instance.status !== "ACTIVE"
      || instance.enrollmentPolicy !== "MANUAL"
      || now < instance.startsAt
      || now >= instance.endsAt
    ) {
      throw new GamificationError(
        "GAMIFICATION_INVALID_INPUT",
        "Only active MANUAL Challenges can be joined.",
      );
    }
    const rules = await getChallengeRuleSetVersion(instance.ruleSetVersion, tx);
    const definition = rules.definitions.challengeDefinitionContracts.find(
      (item) => item.id === instance.challengeDefinitionId,
    );
    if (!definition) {
      throw new GamificationError(
        "GAMIFICATION_CHALLENGE_DEFINITION_VERSION_NOT_FOUND",
        "Challenge definition is unavailable.",
      );
    }
    assertChallengeInstanceDefinitionMatches(
      instance,
      definition,
      getBaghdadWeekPeriod(instance.startsAt),
    );
    const existing = await tx.userChallengeProgress.findUnique({
      where: {
        userId_challengeInstanceId: {
          userId: input.userId,
          challengeInstanceId: instance.id,
        },
      },
    });
    if (existing && existing.status !== "ACTIVE") {
      throw new GamificationError(
        "GAMIFICATION_INVALID_INPUT",
        "A final Challenge enrollment cannot be reopened.",
      );
    }
    const progress = existing ?? await tx.userChallengeProgress.create({
      data: {
        userId: input.userId,
        challengeInstanceId: instance.id,
        status: "ACTIVE",
        metricId: instance.metricId,
        baselineValue: 0n,
        currentValue: 0n,
        targetValue: instance.targetValue,
        enrolledAt: now,
        lastEvaluatedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    await evaluateProgress(
      tx,
      progress,
      instance,
      now,
      new Map([[rules.ruleSet.version, rules]]),
      new Map(),
    );
    const refreshed = await tx.userChallengeProgress.findUnique({
      where: { id: progress.id },
    });
    if (!refreshed) {
      throw new GamificationError(
        "GAMIFICATION_CHALLENGE_PROGRESS_INVALID",
        "Challenge enrollment disappeared during evaluation.",
      );
    }
    return refreshed;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5_000,
    timeout: 20_000,
  });
}

export async function leaveChallenge(
  input: { userId: string; challengeInstanceId: string },
  database: ChallengeDatabase = getPrisma(),
): Promise<UserChallengeProgress> {
  assertUserId(input?.userId);
  if (
    typeof input.challengeInstanceId !== "string"
    || input.challengeInstanceId.length === 0
    || input.challengeInstanceId.length > 128
  ) {
    throw new GamificationError(
      "GAMIFICATION_INVALID_INPUT",
      "Challenge instance ID is invalid.",
    );
  }
  return database.$transaction(async (tx) => {
    await acquireUserChallengesLock(tx, input.userId);
    await requireUser(tx, input.userId);
    const instance = await tx.challengeInstance.findUnique({
      where: { id: input.challengeInstanceId },
    });
    if (!instance) {
      throw new GamificationError(
        "GAMIFICATION_CHALLENGE_INSTANCE_INVALID",
        "Challenge instance was not found.",
      );
    }
    const now = await databaseNow(tx);
    if (
      instance.status !== "ACTIVE"
      || now < instance.startsAt
      || now >= instance.endsAt
    ) {
      throw new GamificationError(
        "GAMIFICATION_INVALID_INPUT",
        "Only a currently active Challenge can be left.",
      );
    }
    const rules = await getChallengeRuleSetVersion(instance.ruleSetVersion, tx);
    const definition = rules.definitions.challengeDefinitionContracts.find(
      (item) => item.id === instance.challengeDefinitionId,
    );
    if (!definition) {
      throw new GamificationError(
        "GAMIFICATION_CHALLENGE_DEFINITION_VERSION_NOT_FOUND",
        "Challenge definition is unavailable.",
      );
    }
    assertChallengeInstanceDefinitionMatches(
      instance,
      definition,
      getBaghdadWeekPeriod(instance.startsAt),
    );
    if (instance.enrollmentPolicy !== "MANUAL") {
      throw new GamificationError(
        "GAMIFICATION_INVALID_INPUT",
        "AUTO Challenges cannot be left manually.",
      );
    }
    const progress = await tx.userChallengeProgress.findUnique({
      where: {
        userId_challengeInstanceId: {
          userId: input.userId,
          challengeInstanceId: instance.id,
        },
      },
    });
    if (!progress || progress.status !== "ACTIVE") {
      throw new GamificationError(
        "GAMIFICATION_INVALID_INPUT",
        "Only an active Challenge enrollment can be left.",
      );
    }
    return tx.userChallengeProgress.update({
      where: { id: progress.id },
      data: {
        status: "LEFT",
        lastEvaluatedAt: now,
        updatedAt: now,
      },
    });
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5_000,
    timeout: 20_000,
  });
}