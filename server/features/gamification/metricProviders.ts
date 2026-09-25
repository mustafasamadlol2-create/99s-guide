import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { getStudyPointsReadModel } from "../study-points/readModel.js";
import { assertValidStudyPointsUserId } from "../study-points/validation.js";
import { GAMIFICATION_METRIC_IDS, GAMIFICATION_METRIC_SOURCE_VERSIONS } from "./constants.js";
import { GamificationError } from "./errors.js";
import type {
  GamificationMetricDatabase,
  GamificationMetricProvider,
} from "./types.js";

function assertValidAsOf(asOf: Date): void {
  if (!(asOf instanceof Date) || !Number.isSafeInteger(asOf.getTime())) {
    throw new GamificationError(
      "GAMIFICATION_INVALID_INPUT",
      "asOf must be a valid Date.",
    );
  }
}

function assertCanonicalCount(value: number | bigint | null): number {
  const numeric = typeof value === "bigint" ? Number(value) : value;
  if (
    typeof numeric !== "number"
    || !Number.isSafeInteger(numeric)
    || numeric < 0
  ) {
    throw new GamificationError(
      "GAMIFICATION_METRIC_VALUE_INVALID",
      "Canonical metric source returned an invalid nonnegative integer.",
    );
  }
  return numeric;
}

function focusProvider(
  metricId: string,
  database: PrismaClient,
): GamificationMetricProvider {
  return {
    async readValue(userId, asOf, tx) {
      assertValidStudyPointsUserId(userId);
      assertValidAsOf(asOf);
      const source: GamificationMetricDatabase = tx ?? database;
      const where = {
        userId,
        status: "COMPLETED",
        activeSeconds: { gt: 0 },
        actualEndedAt: { lte: asOf },
      };

      if (metricId === GAMIFICATION_METRIC_IDS.focusCompletedSessions) {
        return assertCanonicalCount(
          await source.focusSession.count({ where }),
        );
      }

      const result = await source.focusSession.aggregate({
        where,
        _sum: { activeSeconds: true },
      });
      return assertCanonicalCount(result._sum.activeSeconds);
    },
  };
}

function groupFocusProvider(
  metricId: string,
  database: PrismaClient,
): GamificationMetricProvider {
  return {
    async readValue(userId, asOf, tx) {
      assertValidStudyPointsUserId(userId);
      assertValidAsOf(asOf);
      const source: GamificationMetricDatabase = tx ?? database;
      const where = {
        userId,
        verifiedFocusSeconds: { gt: 0 },
        run: {
          runtimeStartedAt: { lte: asOf },
          runtimeEndedAt: { lte: asOf },
        },
      };

      if (metricId === GAMIFICATION_METRIC_IDS.groupFocusCompletedRuns) {
        return assertCanonicalCount(
          await source.groupFocusParticipantSummary.count({ where }),
        );
      }

      const result = await source.groupFocusParticipantSummary.aggregate({
        where,
        _sum: { verifiedFocusSeconds: true },
      });
      return assertCanonicalCount(result._sum.verifiedFocusSeconds);
    },
  };
}

function pointsProvider(
  metricId: string,
  database: PrismaClient,
): GamificationMetricProvider {
  return {
    async readValue(userId, asOf) {
      assertValidStudyPointsUserId(userId);
      assertValidAsOf(asOf);
      // The Prompt 21 service owns compatibility-mode and cutover safety checks.
      // It uses a repeatable-read transaction internally and is the only points
      // source used here; gamification never writes or repairs points.
      const balance = await getStudyPointsReadModel({ userId }, database);
      switch (metricId) {
        case GAMIFICATION_METRIC_IDS.pointsTotal:
          return assertCanonicalCount(balance.totalPoints);
        case GAMIFICATION_METRIC_IDS.pointsFocus:
          return assertCanonicalCount(balance.focusPoints);
        case GAMIFICATION_METRIC_IDS.pointsMastery:
          return assertCanonicalCount(balance.masteryPoints);
        case GAMIFICATION_METRIC_IDS.pointsProgress:
          return assertCanonicalCount(balance.progressPoints);
        case GAMIFICATION_METRIC_IDS.pointsConsistency:
          return assertCanonicalCount(balance.consistencyPoints);
        default:
          throw new GamificationError(
            "GAMIFICATION_METRIC_PROVIDER_UNAVAILABLE",
            `No Study Points provider is registered for ${metricId}.`,
          );
      }
    },
  };
}

export function createGamificationMetricProviders(
  database: PrismaClient = getPrisma() as PrismaClient,
): ReadonlyMap<string, GamificationMetricProvider> {
  const providers = new Map<string, GamificationMetricProvider>();
  for (const metricId of [
    GAMIFICATION_METRIC_IDS.pointsTotal,
    GAMIFICATION_METRIC_IDS.pointsFocus,
    GAMIFICATION_METRIC_IDS.pointsMastery,
    GAMIFICATION_METRIC_IDS.pointsProgress,
    GAMIFICATION_METRIC_IDS.pointsConsistency,
  ]) {
    providers.set(metricId, pointsProvider(metricId, database));
  }
  for (const metricId of [
    GAMIFICATION_METRIC_IDS.focusCompletedSessions,
    GAMIFICATION_METRIC_IDS.focusVerifiedSeconds,
  ]) {
    providers.set(metricId, focusProvider(metricId, database));
  }
  for (const metricId of [
    GAMIFICATION_METRIC_IDS.groupFocusCompletedRuns,
    GAMIFICATION_METRIC_IDS.groupFocusVerifiedSeconds,
  ]) {
    providers.set(metricId, groupFocusProvider(metricId, database));
  }
  return providers;
}

export function assertMetricProviderValue(
  value: unknown,
  valueType: "INTEGER" | "BOOLEAN",
  metricId: string,
): asserts value is number | boolean {
  const valid =
    valueType === "BOOLEAN"
      ? typeof value === "boolean"
      : typeof value === "number"
        && Number.isSafeInteger(value)
        && value >= 0;
  if (!valid) {
    throw new GamificationError(
      "GAMIFICATION_METRIC_VALUE_INVALID",
      `Provider for ${metricId} returned a value inconsistent with its registry definition.`,
    );
  }
}

export type GamificationMetricTransaction = Prisma.TransactionClient;