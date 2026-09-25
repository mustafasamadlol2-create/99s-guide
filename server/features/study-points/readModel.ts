import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { safeStudyPointsAggregate, safeStudyPointsSum } from "./aggregate.js";
import { getStudyPointsCutoverReadiness } from "./cutover.js";
import { StudyPointsError } from "./errors.js";
import {
  aggregateCanonicalStudyPointsLedgerBalance,
  type CanonicalStudyPointsLedgerBalance,
} from "./balanceProjection.js";
import { assertValidStudyPointsUserId } from "./validation.js";
import type {
  StudyPointsBalanceReadModel,
  StudyPointsCompatibilityMode,
} from "./types.js";

const MODES = new Set<StudyPointsCompatibilityMode>([
  "LEGACY_ONLY",
  "LEGACY_PLUS_LEDGER",
  "LEDGER_ONLY",
]);

export function resolveStudyPointsReadMode(
  configured = process.env.STUDY_POINTS_READ_MODE,
): StudyPointsCompatibilityMode {
  if (configured === undefined || configured === "") return "LEGACY_ONLY";
  return MODES.has(configured as StudyPointsCompatibilityMode)
    ? configured as StudyPointsCompatibilityMode
    : "LEGACY_ONLY";
}

function categoriesFrom(
  balance: CanonicalStudyPointsLedgerBalance,
): Pick<
  StudyPointsBalanceReadModel,
  "focusPoints" | "masteryPoints" | "progressPoints" | "consistencyPoints" | "ledgerPoints"
> {
  return {
    focusPoints: balance.focusPoints,
    masteryPoints: balance.masteryPoints,
    progressPoints: balance.progressPoints,
    consistencyPoints: balance.consistencyPoints,
    ledgerPoints: balance.totalPoints,
  };
}

export async function getStudyPointsReadModel(input: {
  userId: string;
  compatibilityMode?: StudyPointsCompatibilityMode;
}, database: PrismaClient = getPrisma() as PrismaClient): Promise<StudyPointsBalanceReadModel> {
  assertValidStudyPointsUserId(input.userId);
  const compatibilityMode = input.compatibilityMode ?? resolveStudyPointsReadMode();
  if (!MODES.has(compatibilityMode)) {
    return getStudyPointsReadModel({
      userId: input.userId,
      compatibilityMode: "LEGACY_ONLY",
    }, database);
  }

  if (compatibilityMode === "LEDGER_ONLY") {
    const readiness = await getStudyPointsCutoverReadiness(input.userId, database);
    if (!readiness.safeForLedgerOnly) {
      throw new StudyPointsError(
        "POINTS_LEDGER_ONLY_NOT_READY",
        "Study Points ledger-only mode is not ready for this account.",
      );
    }
  }

  const values = await database.$transaction(async (tx) => {
    const [projection, legacy, baselineCount] = await Promise.all([
      tx.studyPointsBalanceProjection.findUnique({ where: { userId: input.userId } }),
      tx.pointsLog.aggregate({
        where: { userId: input.userId },
        _sum: { points: true },
      }),
      tx.studyPointsLedgerEntry.count({
        where: {
          userId: input.userId,
          sourceType: "LEGACY_POINTS_LOG",
          reasonCode: "legacy.baseline_import",
        },
      }),
    ]);
    const ledger = projection
      ? {
        focusPoints: safeStudyPointsAggregate(projection.focusPoints),
        masteryPoints: safeStudyPointsAggregate(projection.masteryPoints),
        progressPoints: safeStudyPointsAggregate(projection.progressPoints),
        consistencyPoints: safeStudyPointsAggregate(projection.consistencyPoints),
        totalPoints: safeStudyPointsAggregate(projection.totalPoints),
        ledgerEntryCount: safeStudyPointsAggregate(projection.ledgerEntryCount),
      }
      : await aggregateCanonicalStudyPointsLedgerBalance(tx, input.userId);
    return {
      ledger,
      legacyPoints: safeStudyPointsAggregate(legacy._sum.points),
      baselineCount,
      source: projection ? "PROJECTION" as const : "LEDGER_FALLBACK" as const,
      projectionVersion: projection
        ? safeStudyPointsAggregate(projection.projectionVersion)
        : undefined,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

  if (
    compatibilityMode === "LEGACY_PLUS_LEDGER"
    && values.baselineCount > 0
  ) {
    throw new StudyPointsError(
      "POINTS_LEGACY_BASELINE_CONFLICT",
      "Transitional Study Points mode cannot combine raw legacy history with a ledger baseline.",
    );
  }

  const categoryValues = categoriesFrom(values.ledger);
  let totalPoints: number;
  if (compatibilityMode === "LEGACY_ONLY") {
    totalPoints = values.legacyPoints;
  } else if (compatibilityMode === "LEGACY_PLUS_LEDGER") {
    totalPoints = safeStudyPointsSum(values.legacyPoints, categoryValues.ledgerPoints);
  } else {
    totalPoints = categoryValues.ledgerPoints;
  }
  return {
    ...categoryValues,
    legacyPoints: values.legacyPoints,
    totalPoints,
    compatibilityMode,
    source: values.source,
    ...(values.projectionVersion !== undefined
      ? { projectionVersion: values.projectionVersion }
      : {}),
  };
}