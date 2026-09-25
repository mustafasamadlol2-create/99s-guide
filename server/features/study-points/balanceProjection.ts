import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import {
  STUDY_POINTS_CATEGORIES,
  type StudyPointsCategory,
} from "./constants.js";
import { safeStudyPointsAggregate, safeStudyPointsSum } from "./aggregate.js";
import { StudyPointsError } from "./errors.js";
import { assertValidStudyPointsUserId } from "./validation.js";

export type CanonicalStudyPointsLedgerBalance = {
  focusPoints: number;
  masteryPoints: number;
  progressPoints: number;
  consistencyPoints: number;
  totalPoints: number;
  ledgerEntryCount: number;
};

export type ProjectedStudyPointsBalance =
  CanonicalStudyPointsLedgerBalance & {
    projectionVersion: number;
    lastReconciledAt: Date | null;
  };

const CATEGORY_FIELD: Record<StudyPointsCategory, string> = {
  FOCUS: "focusPoints",
  MASTERY: "masteryPoints",
  PROGRESS: "progressPoints",
  CONSISTENCY: "consistencyPoints",
};

function emptyBalance(): CanonicalStudyPointsLedgerBalance {
  return {
    focusPoints: 0,
    masteryPoints: 0,
    progressPoints: 0,
    consistencyPoints: 0,
    totalPoints: 0,
    ledgerEntryCount: 0,
  };
}

export async function aggregateCanonicalStudyPointsLedgerBalance(
  tx: Prisma.TransactionClient,
  userId: string,
  options: { ignoreUnsupportedCategories?: boolean } = {},
): Promise<CanonicalStudyPointsLedgerBalance> {
  const [groups, countRows] = await Promise.all([
    tx.studyPointsLedgerEntry.groupBy({
      by: ["category"],
      where: { userId },
      _sum: { amount: true },
    }),
    tx.$queryRaw<Array<{ count: string }>>`
      SELECT COUNT(*)::text AS count
      FROM "StudyPointsLedgerEntry"
      WHERE "userId" = ${userId}
    `,
  ]);
  const balance = emptyBalance();
  for (const group of groups) {
    if (!(STUDY_POINTS_CATEGORIES as readonly string[]).includes(group.category)) {
      if (options.ignoreUnsupportedCategories) continue;
      throw new StudyPointsError(
        "POINTS_INVALID_CATEGORY",
        "Canonical Study Points ledger contains an unsupported category.",
      );
    }
    const category = group.category as StudyPointsCategory;
    const field = CATEGORY_FIELD[category] as keyof CanonicalStudyPointsLedgerBalance;
    balance[field] = safeStudyPointsAggregate(group._sum.amount);
    balance.totalPoints = safeStudyPointsSum(
      balance.totalPoints,
      balance[field] as number,
    );
  }
  balance.ledgerEntryCount = safeStudyPointsAggregate(countRows[0]?.count ?? "0");
  return balance;
}

export async function getCanonicalStudyPointsLedgerBalance(
  userId: string,
  database: PrismaClient = getPrisma() as PrismaClient,
): Promise<CanonicalStudyPointsLedgerBalance> {
  assertValidStudyPointsUserId(userId);
  return database.$transaction(
    (tx) => aggregateCanonicalStudyPointsLedgerBalance(tx, userId),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function getProjectedStudyPointsBalance(
  userId: string,
  database: PrismaClient = getPrisma() as PrismaClient,
): Promise<ProjectedStudyPointsBalance | null> {
  assertValidStudyPointsUserId(userId);
  const row = await database.studyPointsBalanceProjection.findUnique({
    where: { userId },
  });
  if (!row) return null;
  return {
    focusPoints: safeStudyPointsAggregate(row.focusPoints),
    masteryPoints: safeStudyPointsAggregate(row.masteryPoints),
    progressPoints: safeStudyPointsAggregate(row.progressPoints),
    consistencyPoints: safeStudyPointsAggregate(row.consistencyPoints),
    totalPoints: safeStudyPointsAggregate(row.totalPoints),
    ledgerEntryCount: safeStudyPointsAggregate(row.ledgerEntryCount),
    projectionVersion: safeStudyPointsAggregate(row.projectionVersion),
    lastReconciledAt: row.lastReconciledAt,
  };
}

export async function updateStudyPointsBalanceProjectionAfterAppend(
  tx: Prisma.TransactionClient,
  userId: string,
  category: StudyPointsCategory,
  amount: number,
): Promise<void> {
  const existing = await tx.studyPointsBalanceProjection.findUnique({
    where: { userId },
    select: { userId: true },
  });
  if (!existing) {
    const canonical = await aggregateCanonicalStudyPointsLedgerBalance(tx, userId);
    await tx.studyPointsBalanceProjection.create({
      data: {
        userId,
        focusPoints: BigInt(canonical.focusPoints),
        masteryPoints: BigInt(canonical.masteryPoints),
        progressPoints: BigInt(canonical.progressPoints),
        consistencyPoints: BigInt(canonical.consistencyPoints),
        totalPoints: BigInt(canonical.totalPoints),
        ledgerEntryCount: BigInt(canonical.ledgerEntryCount),
        projectionVersion: 1n,
      },
    });
    return;
  }

  const field = CATEGORY_FIELD[category] as
    | "focusPoints"
    | "masteryPoints"
    | "progressPoints"
    | "consistencyPoints";
  await tx.studyPointsBalanceProjection.update({
    where: { userId },
    data: {
      [field]: { increment: BigInt(amount) },
      totalPoints: { increment: BigInt(amount) },
      ledgerEntryCount: { increment: 1n },
      projectionVersion: { increment: 1n },
    },
  });
}