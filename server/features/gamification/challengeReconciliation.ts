import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import {
  getActiveChallengeRuleSet,
  getChallengeRuleSetVersion,
} from "./challengeRuleSets.js";
import { getBaghdadWeekPeriod } from "./challengePeriods.js";
import { getChallengeMetricValueForWindow } from "./challengeMetrics.js";
import { deriveChallengeProgressStatus, refreshUserChallenges } from "./challengeRefresh.js";
import { GamificationError } from "./errors.js";
import type {
  ChallengeReconciliationCheck,
  UserChallengeStatus,
} from "./challengeTypes.js";

type ChallengeDatabase = PrismaClient;
type ChallengePeriod = ReturnType<typeof getBaghdadWeekPeriod>;

export type ReconcileUserChallengesInput = {
  userId: string;
  period?: ChallengePeriod;
  repair?: boolean;
  asOf?: Date;
};

export type UserChallengeReconciliation = {
  period: ChallengePeriod;
  ruleSetVersion: string;
  repaired: boolean;
  checks: ChallengeReconciliationCheck[];
};

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function assertPeriod(period: ChallengePeriod): void {
  if (
    !period
    || typeof period.periodKey !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/u.test(period.periodKey)
    || !isValidDate(period.startsAt)
    || !isValidDate(period.endsAt)
    || period.startsAt >= period.endsAt
  ) {
    throw new GamificationError(
      "GAMIFICATION_INVALID_INPUT",
      "Challenge reconciliation period is invalid.",
    );
  }
  const canonical = getBaghdadWeekPeriod(period.startsAt);
  if (
    canonical.periodKey !== period.periodKey
    || canonical.startsAt.getTime() !== period.startsAt.getTime()
    || canonical.endsAt.getTime() !== period.endsAt.getTime()
  ) {
    throw new GamificationError(
      "GAMIFICATION_INVALID_INPUT",
      "Challenge reconciliation requires canonical Baghdad weekly boundaries.",
    );
  }
}

function statusIsValid(status: string): status is UserChallengeStatus {
  return status === "ACTIVE"
    || status === "COMPLETED"
    || status === "EXPIRED"
    || status === "LEFT";
}

function storedInteger(value: bigint): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && BigInt(number) === value
    ? number
    : null;
}

async function inspectPeriod(
  userId: string,
  period: ChallengePeriod,
  asOf: Date,
  database: ChallengeDatabase,
): Promise<{
  ruleSetVersion: string;
  checks: ChallengeReconciliationCheck[];
}> {
  return database.$transaction(async (tx) => {
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
    const instances = await tx.challengeInstance.findMany({
      where: { logicalPeriodKey: period.periodKey },
      orderBy: [
        { sortOrder: "asc" },
        { challengeDefinitionId: "asc" },
        { id: "asc" },
      ],
    });
    const versions = new Set(instances.map(({ ruleSetVersion }) => ruleSetVersion));
    const mixedVersion = versions.size > 1;
    const rules = instances[0]
      ? await getChallengeRuleSetVersion(instances[0].ruleSetVersion, tx)
      : await getActiveChallengeRuleSet(tx);
    const definitions = rules.definitions.challengeDefinitionContracts
      .filter((definition) => definition.windowPolicy === "WEEKLY")
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    const instanceById = new Map(
      instances.map((instance) => [instance.challengeDefinitionId, instance]),
    );
    const checks: ChallengeReconciliationCheck[] = [];

    for (const definition of definitions) {
      const instance = instanceById.get(definition.id);
      if (!instance) {
        checks.push({
          status: "MISSING_INSTANCE",
          challengeDefinitionId: definition.id,
          expected: period.periodKey,
          stored: null,
        });
        continue;
      }
      if (mixedVersion || instance.ruleSetVersion !== rules.ruleSet.version) {
        checks.push({
          status: "WRONG_RULE_VERSION",
          challengeDefinitionId: definition.id,
          instanceId: instance.id,
          expected: rules.ruleSet.version,
          stored: instance.ruleSetVersion,
        });
      }
      if (instance.targetValue !== BigInt(definition.target)) {
        checks.push({
          status: "WRONG_TARGET",
          challengeDefinitionId: definition.id,
          instanceId: instance.id,
          expected: definition.target,
          stored: storedInteger(instance.targetValue),
        });
      }
      if (instance.metricId !== definition.metricId) {
        checks.push({
          status: "WRONG_METRIC",
          challengeDefinitionId: definition.id,
          instanceId: instance.id,
          expected: definition.metricId,
          stored: instance.metricId,
        });
      }
      const progress = await tx.userChallengeProgress.findUnique({
        where: {
          userId_challengeInstanceId: {
            userId,
            challengeInstanceId: instance.id,
          },
        },
      });
      if (!progress) {
        if (definition.enrollmentPolicy === "AUTO" && asOf >= period.startsAt) {
          checks.push({
            status: "MISSING_PROGRESS",
            challengeDefinitionId: definition.id,
            instanceId: instance.id,
          });
        }
        continue;
      }
      if (!statusIsValid(progress.status)) {
        checks.push({
          status: "INVALID_STATUS",
          challengeDefinitionId: definition.id,
          instanceId: instance.id,
          progressId: progress.id,
          stored: progress.status,
        });
      }
      if (
        progress.targetValue !== instance.targetValue
        || progress.targetValue !== BigInt(definition.target)
      ) {
        checks.push({
          status: "WRONG_TARGET",
          challengeDefinitionId: definition.id,
          instanceId: instance.id,
          progressId: progress.id,
          expected: definition.target,
          stored: storedInteger(progress.targetValue),
        });
      }
      if (
        progress.metricId !== instance.metricId
        || progress.metricId !== definition.metricId
      ) {
        checks.push({
          status: "WRONG_METRIC",
          challengeDefinitionId: definition.id,
          instanceId: instance.id,
          progressId: progress.id,
          expected: definition.metricId,
          stored: progress.metricId,
        });
      }
      if (progress.status === "COMPLETED" || progress.status === "LEFT") continue;
      if (
        progress.metricId !== definition.metricId
        || instance.metricId !== definition.metricId
      ) continue;

      const currentValue = await getChallengeMetricValueForWindow({
        userId,
        metricId: definition.metricId,
        startsAt: instance.startsAt,
        endsAt: instance.endsAt,
        asOf,
        tx,
      });
      const targetValue = Number(definition.target);
      const expectedStatus = deriveChallengeProgressStatus({
        currentStatus: statusIsValid(progress.status) ? progress.status : "ACTIVE",
        currentValue,
        targetValue,
        asOf,
        endsAt: instance.endsAt,
      });
      const storedValue = storedInteger(progress.currentValue);
      if (
        storedValue === null
        || storedValue !== currentValue
        || progress.baselineValue !== 0n
      ) {
        checks.push({
          status: "STALE_PROGRESS",
          challengeDefinitionId: definition.id,
          instanceId: instance.id,
          progressId: progress.id,
          expected: currentValue,
          stored: storedValue,
        });
      }
      if (
        expectedStatus === "COMPLETED"
        && progress.status !== "COMPLETED"
      ) {
        checks.push({
          status: "MISSED_COMPLETION",
          challengeDefinitionId: definition.id,
          instanceId: instance.id,
          progressId: progress.id,
          expected: "COMPLETED",
          stored: progress.status,
        });
      } else if (
        expectedStatus === "EXPIRED"
        && progress.status === "ACTIVE"
      ) {
        checks.push({
          status: "MISSED_EXPIRY",
          challengeDefinitionId: definition.id,
          instanceId: instance.id,
          progressId: progress.id,
          expected: "EXPIRED",
          stored: progress.status,
        });
      }
    }
    return { ruleSetVersion: rules.ruleSet.version, checks };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5_000,
    timeout: 60_000,
  });
}

export async function reconcileUserChallenges(
  input: ReconcileUserChallengesInput,
  database: ChallengeDatabase = getPrisma(),
): Promise<UserChallengeReconciliation> {
  if (
    !input
    || typeof input.userId !== "string"
    || input.userId.length === 0
    || input.userId.length > 128
    || input.userId.trim() !== input.userId
  ) {
    throw new GamificationError(
      "GAMIFICATION_INVALID_INPUT",
      "Authenticated user ID is invalid.",
    );
  }
  if (input.repair !== undefined && typeof input.repair !== "boolean") {
    throw new GamificationError(
      "GAMIFICATION_INVALID_INPUT",
      "Challenge repair mode must be a boolean.",
    );
  }
  const asOf = input.asOf ?? new Date();
  if (!isValidDate(asOf)) {
    throw new GamificationError("GAMIFICATION_INVALID_INPUT", "asOf is invalid.");
  }
  const period = input.period ?? getBaghdadWeekPeriod(asOf);
  assertPeriod(period);

  let repaired = false;
  if (input.repair) {
    const currentPeriod = getBaghdadWeekPeriod(asOf);
    if (currentPeriod.periodKey !== period.periodKey) {
      throw new GamificationError(
        "GAMIFICATION_INVALID_INPUT",
        "Challenge repair is limited to the current Baghdad week.",
      );
    }
    await refreshUserChallenges({ userId: input.userId, asOf }, database);
    repaired = true;
  }
  const inspected = await inspectPeriod(
    input.userId,
    period,
    asOf,
    database,
  );
  return {
    period,
    ruleSetVersion: inspected.ruleSetVersion,
    repaired,
    checks: inspected.checks,
  };
}