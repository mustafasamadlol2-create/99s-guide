import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import {
  LEGACY_POINTS_CATEGORY,
  LEGACY_POINTS_RULE_VERSION,
} from "./constants.js";
import { safeStudyPointsAggregate, safeStudyPointsSum } from "./aggregate.js";
import { StudyPointsError } from "./errors.js";
import { assertValidStudyPointsUserId } from "./validation.js";
import type {
  CompatibleStudyPointsBalance,
  LegacyPointsLogRow,
  NormalizedLegacyStudyPointsEntry,
} from "./types.js";

export function normalizeLegacyPointsLog(
  row: LegacyPointsLogRow,
): NormalizedLegacyStudyPointsEntry {
  if (
    !row
    || typeof row.id !== "string"
    || row.id.length < 1
    || row.id.length > 128
    || typeof row.userId !== "string"
    || row.userId.length < 1
    || !Number.isSafeInteger(row.points)
    || typeof row.reason !== "string"
    || !(row.createdAt instanceof Date)
    || !Number.isSafeInteger(row.createdAt.getTime())
  ) {
    throw new StudyPointsError(
      "POINTS_INVALID_SOURCE",
      "Legacy PointsLog row cannot be normalized safely.",
    );
  }
  return {
    recordKind: "LEGACY",
    legacyId: row.id,
    userId: row.userId,
    amount: row.points,
    category: LEGACY_POINTS_CATEGORY,
    reasonCode: "legacy.points_log",
    legacyReason: row.reason,
    sourceType: "LEGACY_POINTS_LOG",
    sourceId: row.id,
    ruleVersion: LEGACY_POINTS_RULE_VERSION,
    effectiveAt: new Date(row.createdAt.getTime()),
    createdAt: new Date(row.createdAt.getTime()),
  };
}

export class StudyPointsLegacyBridgeService {
  constructor(
    private readonly database: PrismaClient = getPrisma() as PrismaClient,
  ) {}

  async getCompatibleStudyPointsBalance(
    userId: string,
  ): Promise<CompatibleStudyPointsBalance> {
    assertValidStudyPointsUserId(userId);
    const result = await this.database.$transaction(async (tx) => {
      const [legacy, ledger] = await Promise.all([
        tx.pointsLog.aggregate({
          where: { userId },
          _sum: { points: true },
        }),
        tx.studyPointsLedgerEntry.aggregate({
          where: { userId },
          _sum: { amount: true },
        }),
      ]);
      return {
        legacyPoints: safeStudyPointsAggregate(legacy._sum.points),
        ledgerPoints: safeStudyPointsAggregate(ledger._sum.amount),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return {
      ...result,
      totalPoints: safeStudyPointsSum(result.legacyPoints, result.ledgerPoints),
      compatibilityMode: "LEGACY_PLUS_LEDGER",
    };
  }
}
