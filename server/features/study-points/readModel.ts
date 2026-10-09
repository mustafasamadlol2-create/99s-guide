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
  if (configured === undefined || configured === "") return "LEGACY_PLUS_LEDGER";
  return MODES.has(configured as StudyPointsCompatibilityMode)
    ? configured as StudyPointsCompatibilityMode
    : "LEGACY_PLUS_LEDGER";
}

/**
 * Active gamification and lifetime leaderboard reads must never fall back to
 * the legacy balance alone. Keep ledger-only reads when cutover is explicitly
 * enabled; otherwise use the compatibility balance that combines the legacy
 * baseline with native ledger activity.
 */
export function resolveUnifiedStudyPointsReadMode(
  configured = process.env.STUDY_POINTS_READ_MODE,
): Exclude<StudyPointsCompatibilityMode, "LEGACY_ONLY"> {
  return resolveStudyPointsReadMode(configured) === "LEDGER_ONLY"
    ? "LEDGER_ONLY"
    : "LEGACY_PLUS_LEDGER";
}

function categoriesFrom(
  balance: CanonicalStudyPointsLedgerBalance,
): Pick<
  StudyPointsBalanceReadModel,
  | "focusPoints"
  | "masteryPoints"
  | "progressPoints"
  | "consistencyPoints"
  | "legacyLedgerPoints"
  | "ledgerPoints"
> {
  return {
    focusPoints: balance.focusPoints,
    masteryPoints: balance.masteryPoints,
    progressPoints: balance.progressPoints,
    consistencyPoints: balance.consistencyPoints,
    legacyLedgerPoints: balance.legacyPoints,
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
    const [projection, user, nativeLedger] = await Promise.all([
      tx.studyPointsBalanceProjection.findUnique({ where: { userId: input.userId } }),
      tx.user.findUnique({
        where: { id: input.userId },
        select: { totalPoints: true },
      }),
      tx.studyPointsLedgerEntry.aggregate({
        where: {
          userId: input.userId,
          sourceType: { not: "LEGACY_POINTS_LOG" },
        },
        _sum: { amount: true },
      }),
    ]);
    if (!user) {
      throw new StudyPointsError(
        "POINTS_USER_NOT_FOUND",
        "Study Points user does not exist.",
      );
    }
    const ledger = projection
      ? {
        focusPoints: safeStudyPointsAggregate(projection.focusPoints),
        masteryPoints: safeStudyPointsAggregate(projection.masteryPoints),
        progressPoints: safeStudyPointsAggregate(projection.progressPoints),
        consistencyPoints: safeStudyPointsAggregate(projection.consistencyPoints),
        legacyPoints: safeStudyPointsAggregate(projection.legacyPoints),
        totalPoints: safeStudyPointsAggregate(projection.totalPoints),
        ledgerEntryCount: safeStudyPointsAggregate(projection.ledgerEntryCount),
      }
      : await aggregateCanonicalStudyPointsLedgerBalance(tx, input.userId);
    return {
      ledger,
      legacyPoints: safeStudyPointsAggregate(user.totalPoints),
      nativeLedgerPoints: safeStudyPointsAggregate(nativeLedger._sum.amount),
      source: projection ? "PROJECTION" as const : "LEDGER_FALLBACK" as const,
      projectionVersion: projection
        ? safeStudyPointsAggregate(projection.projectionVersion)
        : undefined,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

  const categoryValues = categoriesFrom(values.ledger);
  let totalPoints: number;
  if (compatibilityMode === "LEGACY_ONLY") {
    totalPoints = values.legacyPoints;
  } else if (compatibilityMode === "LEGACY_PLUS_LEDGER") {
    totalPoints = safeStudyPointsSum(
      values.legacyPoints,
      values.nativeLedgerPoints,
    );
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

export async function getUnifiedStudyPointsReadModel(
  input: { userId: string },
  database: PrismaClient = getPrisma() as PrismaClient,
): Promise<StudyPointsBalanceReadModel> {
  return getStudyPointsReadModel({
    userId: input.userId,
    compatibilityMode: resolveUnifiedStudyPointsReadMode(),
  }, database);
}