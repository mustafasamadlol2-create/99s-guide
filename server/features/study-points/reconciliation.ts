import { createHash } from "node:crypto";
import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { canonicalJson } from "../study-core/canonicalJson.js";
import { safeStudyPointsAggregate, safeStudyPointsSum } from "./aggregate.js";
import { auditStudyPointsLedger } from "./accountingAudit.js";
import type { StudyPointsAuditEntry } from "./accountingAudit.js";
import {
  aggregateCanonicalStudyPointsLedgerBalance,
  type CanonicalStudyPointsLedgerBalance,
  type ProjectedStudyPointsBalance,
} from "./balanceProjection.js";
import { StudyPointsError } from "./errors.js";
import { studyPointsBalanceProjectionLockKey, lockStudyPointsKeys } from "./locks.js";
import { assertValidStudyPointsUserId } from "./validation.js";

export type StudyPointsReconciliationStatus =
  | "IN_SYNC"
  | "PROJECTION_MISSING"
  | "PROJECTION_DRIFT"
  | "LEDGER_INVARIANT_FAILURE";

export type StudyPointsReconciliationResult = {
  userId: string;
  canonical: CanonicalStudyPointsLedgerBalance;
  projection?: ProjectedStudyPointsBalance;
  legacy: { points: number; rowCount: number };
  checks: Array<{ code: string; status: "PASS" | "FAIL"; occurrences: number }>;
  anomalyCodes: string[];
  status: StudyPointsReconciliationStatus;
  repaired: boolean;
  reconciliationFingerprint: string;
};

const LEDGER_AUDIT_SELECT = {
  id: true,
  userId: true,
  amount: true,
  category: true,
  reasonCode: true,
  sourceType: true,
  sourceId: true,
  ruleVersion: true,
  effectiveAt: true,
  reversalOfEntryId: true,
} satisfies Prisma.StudyPointsLedgerEntrySelect;

const PROJECTION_FIELDS = [
  ["focusPoints", "focusPoints"],
  ["masteryPoints", "masteryPoints"],
  ["progressPoints", "progressPoints"],
  ["consistencyPoints", "consistencyPoints"],
] as const;

type Snapshot = {
  result: StudyPointsReconciliationResult;
  accountingChanged: boolean;
};

function projectionChanged(
  canonical: CanonicalStudyPointsLedgerBalance,
  projection: ProjectedStudyPointsBalance | undefined,
): boolean {
  if (!projection) return true;
  return projection.totalPoints !== canonical.totalPoints
    || projection.ledgerEntryCount !== canonical.ledgerEntryCount
    || PROJECTION_FIELDS.some(([canonicalField, projectionField]) =>
      canonical[canonicalField] !== projection[projectionField])
    || projection.focusPoints
      + projection.masteryPoints
      + projection.progressPoints
      + projection.consistencyPoints !== projection.totalPoints;
}

function toProjection(row: {
  focusPoints: bigint;
  masteryPoints: bigint;
  progressPoints: bigint;
  consistencyPoints: bigint;
  totalPoints: bigint;
  ledgerEntryCount: bigint;
  projectionVersion: bigint;
  lastReconciledAt: Date | null;
}): ProjectedStudyPointsBalance {
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

async function snapshot(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<Snapshot> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) {
    throw new StudyPointsError("POINTS_USER_NOT_FOUND", "Study Points user does not exist.");
  }

  const entries = await tx.studyPointsLedgerEntry.findMany({
    where: { userId },
    select: LEDGER_AUDIT_SELECT,
    orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
  });
  const originalIds = [...new Set(
    entries.flatMap((entry) =>
      entry.reversalOfEntryId !== null ? [entry.reversalOfEntryId] : []),
  )];
  const originals = originalIds.length > 0
    ? await tx.studyPointsLedgerEntry.findMany({
      where: { id: { in: originalIds } },
      select: LEDGER_AUDIT_SELECT,
    })
    : [];
  const originalMap = new Map<string, StudyPointsAuditEntry>(
    originals.map((entry) => [entry.id, entry]),
  );
  const audit = auditStudyPointsLedger(entries, originalMap);

  const [canonical, projectionRow, legacyAggregate, legacyCountRows] = await Promise.all([
    aggregateCanonicalStudyPointsLedgerBalance(tx, userId, {
      ignoreUnsupportedCategories: true,
    }),
    tx.studyPointsBalanceProjection.findUnique({ where: { userId } }),
    tx.pointsLog.aggregate({ where: { userId }, _sum: { points: true } }),
    tx.$queryRaw<Array<{ count: string }>>`
      SELECT COUNT(*)::text AS count
      FROM "PointsLog"
      WHERE "userId" = ${userId}
    `,
  ]);
  const projection = projectionRow ? toProjection(projectionRow) : undefined;
  const projectionDrift = projectionChanged(canonical, projection);
  const categorySum = safeStudyPointsSum(
    safeStudyPointsSum(canonical.focusPoints, canonical.masteryPoints),
    safeStudyPointsSum(canonical.progressPoints, canonical.consistencyPoints),
  );
  const checks = [...audit.checks];
  const addProjectionCheck = (code: string, failed: boolean, occurrences = 1) => {
    checks.push({
      code,
      status: failed ? "FAIL" : "PASS",
      occurrences: failed ? occurrences : 0,
    });
  };
  addProjectionCheck("PROJECTION_MISSING", !projection);
  addProjectionCheck(
    "PROJECTION_TOTAL_MISMATCH",
    Boolean(projection && projection.totalPoints !== canonical.totalPoints),
  );
  const categoryMismatchCount = projection
    ? PROJECTION_FIELDS.filter(([canonicalField, projectionField]) =>
      canonical[canonicalField] !== projection[projectionField]).length
    : 0;
  addProjectionCheck(
    "PROJECTION_CATEGORY_MISMATCH",
    categoryMismatchCount > 0,
    categoryMismatchCount,
  );
  addProjectionCheck(
    "PROJECTION_ENTRY_COUNT_MISMATCH",
    Boolean(projection && projection.ledgerEntryCount !== canonical.ledgerEntryCount),
  );
  addProjectionCheck(
    "PROJECTION_CATEGORY_SUM_MISMATCH",
    Boolean(projection && (
      projection.focusPoints
      + projection.masteryPoints
      + projection.progressPoints
      + projection.consistencyPoints !== projection.totalPoints
    )),
  );
  addProjectionCheck("CANONICAL_CATEGORY_SUM_MISMATCH", categorySum !== canonical.totalPoints);

  const blockingLedgerFailure = audit.blockingCodes.length > 0;
  const status: StudyPointsReconciliationStatus = blockingLedgerFailure
    ? "LEDGER_INVARIANT_FAILURE"
    : !projection
      ? "PROJECTION_MISSING"
      : projectionDrift
        ? "PROJECTION_DRIFT"
        : "IN_SYNC";
  const legacy = {
    points: safeStudyPointsAggregate(legacyAggregate._sum.points),
    rowCount: safeStudyPointsAggregate(legacyCountRows[0]?.count ?? "0"),
  };
  const fingerprintPayload = {
    userId,
    ledgerEntryCount: canonical.ledgerEntryCount,
    focusPoints: canonical.focusPoints,
    masteryPoints: canonical.masteryPoints,
    progressPoints: canonical.progressPoints,
    consistencyPoints: canonical.consistencyPoints,
    totalPoints: canonical.totalPoints,
    legacyRowCount: legacy.rowCount,
    legacyPoints: legacy.points,
  };
  const reconciliationFingerprint = createHash("sha256")
    .update(canonicalJson(fingerprintPayload))
    .digest("hex");
  return {
    result: {
      userId,
      canonical,
      ...(projection ? { projection } : {}),
      legacy,
      checks,
      anomalyCodes: [
        ...audit.anomalyCodes,
        ...checks.filter((check) => check.status === "FAIL")
          .map((check) => check.code)
          .filter((code) => code.startsWith("PROJECTION_")),
      ],
      status,
      repaired: false,
      reconciliationFingerprint,
    },
    accountingChanged: projectionDrift,
  };
}

export async function reconcileStudyPointsAccount(input: {
  userId: string;
  repairProjection?: boolean;
}, database: PrismaClient = getPrisma() as PrismaClient): Promise<StudyPointsReconciliationResult> {
  assertValidStudyPointsUserId(input.userId);
  if (!input.repairProjection) {
    return database.$transaction(
      async (tx) => (await snapshot(tx, input.userId)).result,
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  return database.$transaction(async (tx) => {
    await lockStudyPointsKeys(tx, [
      studyPointsBalanceProjectionLockKey(input.userId),
    ]);
    const before = await snapshot(tx, input.userId);
    if (before.result.status === "LEDGER_INVARIANT_FAILURE") {
      return before.result;
    }

    const existingVersion = before.result.projection?.projectionVersion ?? 0;
    const projectionVersion = before.result.projection
      ? BigInt(existingVersion) + (before.accountingChanged ? 1n : 0n)
      : 1n;
    const now = new Date();
    const canonical = before.result.canonical;
    const repairedProjection = before.result.projection && !before.accountingChanged
      ? await (async () => {
        await tx.$executeRaw`
          UPDATE "StudyPointsBalanceProjection"
          SET "lastReconciledAt" = ${now}
          WHERE "userId" = ${input.userId}
        `;
        return tx.studyPointsBalanceProjection.findUniqueOrThrow({
          where: { userId: input.userId },
        });
      })()
      : await tx.studyPointsBalanceProjection.upsert({
        where: { userId: input.userId },
        create: {
          userId: input.userId,
          focusPoints: BigInt(canonical.focusPoints),
          masteryPoints: BigInt(canonical.masteryPoints),
          progressPoints: BigInt(canonical.progressPoints),
          consistencyPoints: BigInt(canonical.consistencyPoints),
          totalPoints: BigInt(canonical.totalPoints),
          ledgerEntryCount: BigInt(canonical.ledgerEntryCount),
          projectionVersion,
          lastReconciledAt: now,
        },
        update: {
          focusPoints: BigInt(canonical.focusPoints),
          masteryPoints: BigInt(canonical.masteryPoints),
          progressPoints: BigInt(canonical.progressPoints),
          consistencyPoints: BigInt(canonical.consistencyPoints),
          totalPoints: BigInt(canonical.totalPoints),
          ledgerEntryCount: BigInt(canonical.ledgerEntryCount),
          projectionVersion,
          lastReconciledAt: now,
        },
      });
    return {
      ...before.result,
      projection: toProjection(repairedProjection),
      repaired: before.accountingChanged,
    };
  }, { maxWait: 5_000, timeout: 30_000 });
}