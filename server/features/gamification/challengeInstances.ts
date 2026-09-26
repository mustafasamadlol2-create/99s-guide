import {
  Prisma,
  type ChallengeInstance,
  type PrismaClient,
} from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import {
  acquireActiveGamificationRuleSetLock,
} from "./ruleSetService.js";
import {
  getActiveChallengeRuleSet,
  getChallengeRuleSetVersion,
} from "./challengeRuleSets.js";
import { getBaghdadWeekPeriod } from "./challengePeriods.js";
import { GamificationError } from "./errors.js";
import type {
  ChallengeDefinitionContract,
  GamificationDefinitionBundle,
} from "./types.js";

export type ChallengePeriod = ReturnType<typeof getBaghdadWeekPeriod>;
export type ChallengeTransaction = Prisma.TransactionClient;
export type ChallengeDatabase = PrismaClient;

const CHALLENGE_LOCK_NAMESPACE = "99s-guide:gamification:challenges:";

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

async function acquireChallengeLock(
  tx: ChallengeTransaction,
  key: string,
): Promise<void> {
  await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT TRUE AS locked
    FROM (SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))) AS acquired
  `;
}

export async function acquireUserChallengesLock(
  tx: ChallengeTransaction,
  userId: string,
): Promise<void> {
  await acquireChallengeLock(tx, `${CHALLENGE_LOCK_NAMESPACE}user:${userId}`);
}

function assertValidPeriod(period: ChallengePeriod): void {
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
      "Challenge period is invalid.",
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
      "Challenge period must use canonical Baghdad weekly boundaries.",
    );
  }
}

export function assertChallengeInstanceDefinitionMatches(
  instance: ChallengeInstance,
  definition: ChallengeDefinitionContract,
  period: ChallengePeriod,
): void {
  if (
    instance.challengeDefinitionId !== definition.id
    || instance.ruleSetVersion !== definition.ruleSetVersion
    || instance.logicalPeriodKey !== period.periodKey
    || instance.metricId !== definition.metricId
    || instance.targetValue !== BigInt(definition.target)
    || instance.enrollmentPolicy !== definition.enrollmentPolicy
    || instance.windowPolicy !== definition.windowPolicy
    || instance.titleKey !== definition.titleKey
    || instance.descriptionKey !== definition.descriptionKey
    || instance.visibility !== definition.visibility
    || instance.sortOrder !== definition.sortOrder
    || instance.startsAt.getTime() !== period.startsAt.getTime()
    || instance.endsAt.getTime() !== period.endsAt.getTime()
  ) {
    throw new GamificationError(
      "GAMIFICATION_CHALLENGE_INSTANCE_INVALID",
      `Challenge instance ${instance.id} does not match its frozen definition snapshot.`,
    );
  }
}

function getChallengeDefinitions(
  bundle: GamificationDefinitionBundle,
): ChallengeDefinitionContract[] {
  return bundle.challengeDefinitionContracts
    .filter((definition) => definition.windowPolicy === "WEEKLY")
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

function nextInstanceStatus(
  status: string,
  period: ChallengePeriod,
  asOf: Date,
): string {
  if (status === "CANCELLED") return "CANCELLED";
  if (asOf >= period.endsAt) return "ENDED";
  if (asOf >= period.startsAt && status === "UPCOMING") return "ACTIVE";
  return status;
}

/**
 * Ensures exactly the frozen rule version's instances for one Baghdad week.
 * Existing instances choose their own historical bundle, so mid-week rule
 * activation never rewrites the period.
 */
export async function ensureChallengeInstancesInTransaction(
  tx: ChallengeTransaction,
  asOf: Date,
  period: ChallengePeriod = getBaghdadWeekPeriod(asOf),
  requestedRuleSetVersion?: string,
): Promise<{
  ruleSetVersion: string;
  instances: ChallengeInstance[];
}> {
  if (!isValidDate(asOf)) {
    throw new GamificationError("GAMIFICATION_INVALID_INPUT", "asOf is invalid.");
  }
  assertValidPeriod(period);
  await acquireActiveGamificationRuleSetLock(tx);
  await acquireChallengeLock(
    tx,
    `${CHALLENGE_LOCK_NAMESPACE}period:${period.periodKey}`,
  );

  const existing = await tx.challengeInstance.findMany({
    where: { logicalPeriodKey: period.periodKey },
    orderBy: [
      { sortOrder: "asc" },
      { challengeDefinitionId: "asc" },
      { id: "asc" },
    ],
  });
  const existingVersions = new Set(existing.map((instance) => instance.ruleSetVersion));
  if (existingVersions.size > 1) {
    throw new GamificationError(
      "GAMIFICATION_CHALLENGE_INSTANCE_INVALID",
      `Baghdad week ${period.periodKey} contains mixed Challenge rule versions.`,
    );
  }

  const frozenVersion = existing[0]?.ruleSetVersion;
  const rules = frozenVersion
    ? await getChallengeRuleSetVersion(frozenVersion, tx)
    : requestedRuleSetVersion
      ? await getChallengeRuleSetVersion(requestedRuleSetVersion, tx)
      : await getActiveChallengeRuleSet(tx);
  const definitions = getChallengeDefinitions(rules.definitions);
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const existingById = new Map(
    existing.map((instance) => [instance.challengeDefinitionId, instance]),
  );

  for (const instance of existing) {
    const definition = byId.get(instance.challengeDefinitionId);
    if (!definition) {
      throw new GamificationError(
        "GAMIFICATION_CHALLENGE_INSTANCE_INVALID",
        `Challenge instance ${instance.id} has no definition in its frozen rule set.`,
      );
    }
    assertChallengeInstanceDefinitionMatches(instance, definition, period);
  }

  const missing = definitions.filter((definition) => !existingById.has(definition.id));
  if (missing.length > 0) {
    const now = new Date(asOf);
    await tx.challengeInstance.createMany({
      data: missing.map((definition) => ({
        challengeDefinitionId: definition.id,
        ruleSetVersion: rules.ruleSet.version,
        logicalPeriodKey: period.periodKey,
        metricId: definition.metricId,
        targetValue: BigInt(definition.target),
        enrollmentPolicy: definition.enrollmentPolicy,
        windowPolicy: definition.windowPolicy,
        titleKey: definition.titleKey,
        descriptionKey: definition.descriptionKey,
        visibility: definition.visibility,
        sortOrder: definition.sortOrder,
        startsAt: period.startsAt,
        endsAt: period.endsAt,
        status: now < period.startsAt
          ? "UPCOMING"
          : now >= period.endsAt
            ? "ENDED"
            : "ACTIVE",
        createdAt: now,
        updatedAt: now,
      })),
      skipDuplicates: true,
    });
  }

  const instances = await tx.challengeInstance.findMany({
    where: { logicalPeriodKey: period.periodKey },
    orderBy: [
      { sortOrder: "asc" },
      { challengeDefinitionId: "asc" },
      { id: "asc" },
    ],
  });
  if (
    instances.length !== definitions.length
    || instances.some((instance) =>
      instance.ruleSetVersion !== rules.ruleSet.version
      || !byId.has(instance.challengeDefinitionId))
  ) {
    throw new GamificationError(
      "GAMIFICATION_CHALLENGE_INSTANCE_INVALID",
      `Challenge instances for ${period.periodKey} could not be ensured consistently.`,
    );
  }
  for (const instance of instances) {
    const definition = byId.get(instance.challengeDefinitionId)!;
    assertChallengeInstanceDefinitionMatches(instance, definition, period);
    const status = nextInstanceStatus(instance.status, period, asOf);
    if (status !== instance.status) {
      await tx.challengeInstance.update({
        where: { id: instance.id },
        data: { status, updatedAt: asOf },
      });
      instance.status = status;
      instance.updatedAt = asOf;
    }
  }
  return { ruleSetVersion: rules.ruleSet.version, instances };
}

export async function refreshChallengeInstanceStatusesInTransaction(
  tx: ChallengeTransaction,
  asOf: Date,
): Promise<void> {
  if (!isValidDate(asOf)) {
    throw new GamificationError("GAMIFICATION_INVALID_INPUT", "asOf is invalid.");
  }
  await tx.challengeInstance.updateMany({
    where: {
      status: { in: ["UPCOMING", "ACTIVE"] },
      endsAt: { lte: asOf },
    },
    data: { status: "ENDED", updatedAt: asOf },
  });
  await tx.challengeInstance.updateMany({
    where: {
      status: "UPCOMING",
      startsAt: { lte: asOf },
      endsAt: { gt: asOf },
    },
    data: { status: "ACTIVE", updatedAt: asOf },
  });
}

export async function ensureChallengeInstancesForPeriod(input: {
  period: ChallengePeriod;
  asOf?: Date;
  ruleSetVersion?: string;
}, database: ChallengeDatabase = getPrisma()): Promise<{
  ruleSetVersion: string;
  instances: ChallengeInstance[];
}> {
  const asOf = input.asOf ?? new Date();
  return database.$transaction(
    (tx) => ensureChallengeInstancesInTransaction(
      tx,
      asOf,
      input.period,
      input.ruleSetVersion,
    ),
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 20_000,
    },
  );
}

export async function getCurrentChallengeInstances(
  asOf = new Date(),
  database: ChallengeDatabase = getPrisma(),
): Promise<{
  ruleSetVersion: string;
  period: ChallengePeriod;
  instances: ChallengeInstance[];
}> {
  const period = getBaghdadWeekPeriod(asOf);
  const ensured = await ensureChallengeInstancesForPeriod(
    { period, asOf },
    database,
  );
  return { ...ensured, period };
}