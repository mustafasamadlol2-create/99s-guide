import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import {
  STUDY_POINTS_CATEGORIES,
  type StudyPointsCategory,
  type StudyPointsLedgerCategory,
} from "./constants.js";
import { safeStudyPointsAggregate, safeStudyPointsSum } from "./aggregate.js";
import { StudyPointsError } from "./errors.js";
import { assertValidStudyPointsUserId } from "./validation.js";
import { getStudyPointsCompetitiveEpoch } from "./epoch.js";

export type CanonicalStudyPointsLedgerBalance = {
  focusPoints: number;
  masteryPoints: number;
  progressPoints: number;
  consistencyPoints: number;
  legacyPoints: number;
  totalPoints: number;
  ledgerEntryCount: number;
};

export type ProjectedStudyPointsBalance =
  CanonicalStudyPointsLedgerBalance & {
    projectionVersion: number;
    lastReconciledAt: Date | null;
  };

const CATEGORY_FIELD: Record<StudyPointsLedgerCategory, string> = {
  FOCUS: "focusPoints",
  MASTERY: "masteryPoints",
  PROGRESS: "progressPoints",
  CONSISTENCY: "consistencyPoints",
  LEGACY: "legacyPoints",
};

function emptyBalance(): CanonicalStudyPointsLedgerBalance {
  return {
    focusPoints: 0,
    masteryPoints: 0,
    progressPoints: 0,
    consistencyPoints: 0,
    legacyPoints: 0,
    totalPoints: 0,
    ledgerEntryCount: 0,
  };
}

export async function aggregateCanonicalStudyPointsLedgerBalance(
  tx: Prisma.TransactionClient,
  userId: string,
  options: { ignoreUnsupportedCategories?: boolean } = {},
): Promise<CanonicalStudyPointsLedgerBalance> {
  const epoch = getStudyPointsCompetitiveEpoch();
  const [groups, countRows] = await Promise.all([
    tx.$queryRaw<Array<{ category: string; amount: string }>>`
      SELECT
        CASE
          WHEN "reasonCode" IN (
            'mcq.first_verified_correct',
            'flashcard.first_verified_recall',
            'mcq.set_verified_pass'
          ) THEN 'MASTERY'
          ELSE "category"
        END AS category,
        COALESCE(SUM("amount"), 0)::text AS amount
      FROM "StudyPointsLedgerEntry"
      WHERE "userId" = ${userId}
        AND "effectiveAt" >= ${epoch}
        AND "sourceType" <> 'LEGACY_POINTS_LOG'
        AND "category" <> 'LEGACY'
      GROUP BY 1
    `,
    tx.$queryRaw<Array<{ count: string }>>`
      SELECT COUNT(*)::text AS count
      FROM "StudyPointsLedgerEntry"
      WHERE "userId" = ${userId}
        AND "effectiveAt" >= ${epoch}
        AND "sourceType" <> 'LEGACY_POINTS_LOG'
        AND "category" <> 'LEGACY'
    `,
  ]);
  const balance = emptyBalance();
  for (const group of groups) {
    // Legacy rows are permanently outside Points V2 even if malformed data
    // happens to carry a post-epoch timestamp.
    if (group.category === "LEGACY") continue;
    if (!(STUDY_POINTS_CATEGORIES as readonly string[]).includes(group.category)) {
      if (options.ignoreUnsupportedCategories) continue;
      throw new StudyPointsError(
        "POINTS_INVALID_CATEGORY",
        "Canonical Study Points ledger contains an unsupported category.",
      );
    }
    const category = group.category as StudyPointsCategory;
    const field = CATEGORY_FIELD[category] as keyof CanonicalStudyPointsLedgerBalance;
    // Raw SQL above aliases the aggregate directly as `amount`; this is not a
    // Prisma aggregate result and therefore has no `_sum` wrapper. Reading
    // `group._sum.amount` throws at runtime and breaks every canonical Points
    // consumer (Engagement Overview, achievements, auth/profile sync, etc.).
    balance[field] = safeStudyPointsAggregate(group.amount);
    balance.totalPoints = safeStudyPointsSum(
      balance.totalPoints,
      balance[field] as number,
    );
  }
  balance.legacyPoints = 0;
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
  return database.$transaction(async (tx) => {
    const row = await tx.studyPointsBalanceProjection.findUnique({
      where: { userId },
    });
    if (!row) return null;
    // The stored projection may predate the V2 competitive epoch. Reads are
    // therefore canonicalized from the ledger window while retaining only
    // projection metadata for diagnostics.
    const canonical = await aggregateCanonicalStudyPointsLedgerBalance(tx, userId);
    return {
      ...canonical,
      projectionVersion: safeStudyPointsAggregate(row.projectionVersion),
      lastReconciledAt: row.lastReconciledAt,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function updateStudyPointsBalanceProjectionAfterAppend(
  tx: Prisma.TransactionClient,
  userId: string,
  _category: StudyPointsLedgerCategory,
  _amount: number,
): Promise<void> {
  // Rebuild the tiny per-user projection from the canonical V2 window instead
  // of incrementing an older projection that may still contain pre-cutover or
  // legacy balances. This also makes the first post-cutover award self-healing.
  const canonical = await aggregateCanonicalStudyPointsLedgerBalance(tx, userId);
  await tx.studyPointsBalanceProjection.upsert({
    where: { userId },
    create: {
      userId,
      focusPoints: BigInt(canonical.focusPoints),
      masteryPoints: BigInt(canonical.masteryPoints),
      progressPoints: BigInt(canonical.progressPoints),
      consistencyPoints: BigInt(canonical.consistencyPoints),
      legacyPoints: 0n,
      totalPoints: BigInt(canonical.totalPoints),
      ledgerEntryCount: BigInt(canonical.ledgerEntryCount),
      projectionVersion: 1n,
    },
    update: {
      focusPoints: BigInt(canonical.focusPoints),
      masteryPoints: BigInt(canonical.masteryPoints),
      progressPoints: BigInt(canonical.progressPoints),
      consistencyPoints: BigInt(canonical.consistencyPoints),
      legacyPoints: 0n,
      totalPoints: BigInt(canonical.totalPoints),
      ledgerEntryCount: BigInt(canonical.ledgerEntryCount),
      projectionVersion: { increment: 1n },
    },
  });
}
