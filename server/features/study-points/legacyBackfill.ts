import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { safeStudyPointsAggregate } from "./aggregate.js";
import {
  LEGACY_POINTS_CATEGORY,
  LEGACY_POINTS_RULE_VERSION,
  STUDY_POINTS_MAX_ENTRY_AMOUNT,
} from "./constants.js";
import { StudyPointsError } from "./errors.js";
import { studyPointsBalanceProjectionLockKey, lockStudyPointsKeys } from "./locks.js";
import { updateStudyPointsBalanceProjectionAfterAppend } from "./balanceProjection.js";
import { normalizeLegacyPointsLog } from "./legacyBridge.js";
import { reconcileStudyPointsAccount } from "./reconciliation.js";

const LEGACY_LOG_REASON = "legacy.points_log";
const LEGACY_ADJUSTMENT_REASON = "legacy.user_total_adjustment";
const LEGACY_BASELINE_REASON = "legacy.baseline_import";
const DEFAULT_BATCH_SIZE = 100;

type LegacyLogRow = {
  id: string;
  userId: string;
  points: number;
  reason: string;
  createdAt: Date;
};

type CutoverMarker = {
  userId: string;
  legacyUserPoints: number;
  legacyPointsLogTotal: bigint;
  legacyPointsLogRowCount: bigint;
  legacyAdjustment: bigint;
  status: string;
  capturedAt: Date;
  completedAt: Date | null;
};

export type StudyPointsLegacyImportAudit = {
  userId: string;
  userExists: boolean;
  markerExists: boolean;
  markerStatus: string | null;
  legacyUserPoints: number;
  pointsLogTotal: number;
  pointsLogRowCount: number;
  importedPointLogRows: number;
  missingPointLogRows: number;
  invalidPointLogRows: number;
  orphanPointLogImports: number;
  importedPointLogPoints: number;
  legacyAdjustment: number;
  importedAdjustment: number;
  invalidAdjustmentRows: number;
  unsupportedBaselineRows: number;
  unsupportedLegacyRows: number;
  sourceSnapshotMatches: boolean;
  complete: boolean;
};

export type StudyPointsLegacyBackfillBatchResult = {
  userId: string;
  importedPointLogRows: number;
  importedLedgerEntries: number;
  remainingPointLogRows: number;
  cutoverStatus: "PENDING" | "COMPLETED";
};

function safeBigIntNumber(value: bigint, message: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)
    || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new StudyPointsError("POINTS_AGGREGATE_OVERFLOW", message);
  }
  return Number(value);
}

function chunks(amount: number): number[] {
  if (!Number.isSafeInteger(amount)) {
    throw new StudyPointsError(
      "POINTS_INVALID_AMOUNT",
      "Legacy point amount is outside the safe integer range.",
    );
  }
  const result: number[] = [];
  let remaining = amount;
  while (remaining !== 0) {
    const next = Math.sign(remaining)
      * Math.min(Math.abs(remaining), STUDY_POINTS_MAX_ENTRY_AMOUNT);
    result.push(next);
    remaining -= next;
  }
  return result;
}

function sameInstant(left: Date, right: Date): boolean {
  return left.getTime() === right.getTime();
}

async function appendLegacyChunk(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    amount: number;
    sourceId: string;
    reasonCode: string;
    ruleVersion: string;
    idempotencyKey: string;
    effectiveAt: Date;
  },
): Promise<boolean> {
  const where = {
    userId_idempotencyKey: {
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
    },
  };
  const existing = await tx.studyPointsLedgerEntry.findUnique({ where });
  if (existing) {
    if (
      existing.amount !== input.amount
      || existing.category !== LEGACY_POINTS_CATEGORY
      || existing.sourceType !== "LEGACY_POINTS_LOG"
      || existing.sourceId !== input.sourceId
      || existing.reasonCode !== input.reasonCode
      || existing.ruleVersion !== input.ruleVersion
      || !sameInstant(existing.effectiveAt, input.effectiveAt)
      || existing.reversalOfEntryId !== null
    ) {
      throw new StudyPointsError(
        "POINTS_IDEMPOTENCY_CONFLICT",
        "A legacy backfill idempotency key already has different point data.",
      );
    }
    return false;
  }

  await tx.studyPointsLedgerEntry.create({
    data: {
      userId: input.userId,
      amount: input.amount,
      category: LEGACY_POINTS_CATEGORY,
      sourceType: "LEGACY_POINTS_LOG",
      sourceId: input.sourceId,
      reasonCode: input.reasonCode,
      ruleVersion: input.ruleVersion,
      idempotencyKey: input.idempotencyKey,
      effectiveAt: input.effectiveAt,
    },
  });
  await updateStudyPointsBalanceProjectionAfterAppend(
    tx,
    input.userId,
    LEGACY_POINTS_CATEGORY,
    input.amount,
  );
  return true;
}

async function getSourceSnapshot(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<{
  legacyUserPoints: number;
  legacyPointsLogTotal: bigint;
  legacyPointsLogRowCount: bigint;
  legacyAdjustment: bigint;
}> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { totalPoints: true },
  });
  if (!user) {
    throw new StudyPointsError(
      "POINTS_USER_NOT_FOUND",
      "Study Points user does not exist.",
    );
  }
  const [stats] = await tx.$queryRaw<Array<{
    pointsLogTotal: bigint;
    pointsLogRowCount: bigint;
  }>>`
    SELECT
      COALESCE(SUM("points"), 0)::bigint AS "pointsLogTotal",
      COUNT(*) FILTER (WHERE "points" <> 0)::bigint AS "pointsLogRowCount"
    FROM "PointsLog"
    WHERE "userId" = ${userId}
  `;
  const pointsLogTotal = stats?.pointsLogTotal ?? 0n;
  const legacyAdjustment = BigInt(user.totalPoints) - pointsLogTotal;
  return {
    legacyUserPoints: user.totalPoints,
    legacyPointsLogTotal: pointsLogTotal,
    legacyPointsLogRowCount: stats?.pointsLogRowCount ?? 0n,
    legacyAdjustment,
  };
}

function assertSnapshotMatches(
  marker: CutoverMarker,
  snapshot: Awaited<ReturnType<typeof getSourceSnapshot>>,
): void {
  if (
    marker.legacyUserPoints !== snapshot.legacyUserPoints
    || marker.legacyPointsLogTotal !== snapshot.legacyPointsLogTotal
    || marker.legacyPointsLogRowCount !== snapshot.legacyPointsLogRowCount
    || marker.legacyAdjustment !== snapshot.legacyAdjustment
  ) {
    throw new StudyPointsError(
      "POINTS_LEGACY_SOURCE_CHANGED",
      "Legacy point history changed after its cutover snapshot was captured.",
    );
  }
}

async function ensureCutoverMarker(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<CutoverMarker> {
  const existing = await tx.studyPointsLegacyCutover.findUnique({
    where: { userId },
  });
  const snapshot = await getSourceSnapshot(tx, userId);
  if (existing) {
    assertSnapshotMatches(existing, snapshot);
    return existing;
  }
  return tx.studyPointsLegacyCutover.create({
    data: {
      userId,
      ...snapshot,
      status: "PENDING",
    },
  });
}

async function importUserAdjustment(
  tx: Prisma.TransactionClient,
  marker: CutoverMarker,
): Promise<number> {
  const delta = safeBigIntNumber(
    marker.legacyAdjustment,
    "Legacy user balance adjustment exceeds the safe integer range.",
  );
  const amountChunks = chunks(delta);
  let created = 0;
  for (let index = 0; index < amountChunks.length; index += 1) {
    const inserted = await appendLegacyChunk(tx, {
      userId: marker.userId,
      amount: amountChunks[index]!,
      sourceId: marker.userId,
      reasonCode: LEGACY_ADJUSTMENT_REASON,
      ruleVersion: LEGACY_POINTS_RULE_VERSION,
      idempotencyKey: `legacy-user-total-adjustment:${marker.userId}:${index}`,
      effectiveAt: marker.capturedAt,
    });
    if (inserted) created += 1;
  }
  const existing = await tx.studyPointsLedgerEntry.findMany({
    where: {
      userId: marker.userId,
      sourceType: "LEGACY_POINTS_LOG",
      reasonCode: LEGACY_ADJUSTMENT_REASON,
    },
    select: { amount: true },
  });
  if (
    existing.length !== amountChunks.length
    || existing.reduce((sum, entry) => sum + BigInt(entry.amount), 0n)
      !== marker.legacyAdjustment
  ) {
    throw new StudyPointsError(
      "POINTS_LEGACY_ADJUSTMENT_MISMATCH",
      "Legacy user-total adjustment does not match the captured balance.",
    );
  }
  return created;
}

async function importLegacyLog(
  tx: Prisma.TransactionClient,
  row: LegacyLogRow,
): Promise<number> {
  const normalized = normalizeLegacyPointsLog(row);
  const amountChunks = chunks(normalized.amount);
  let created = 0;
  for (let index = 0; index < amountChunks.length; index += 1) {
    const inserted = await appendLegacyChunk(tx, {
      userId: normalized.userId,
      amount: amountChunks[index]!,
      sourceId: normalized.sourceId,
      reasonCode: normalized.reasonCode,
      ruleVersion: normalized.ruleVersion,
      idempotencyKey: `legacy-pointslog:${normalized.legacyId}:${index}`,
      effectiveAt: normalized.effectiveAt,
    });
    if (inserted) created += 1;
  }
  const existing = await tx.studyPointsLedgerEntry.findMany({
    where: {
      userId: normalized.userId,
      sourceType: "LEGACY_POINTS_LOG",
      reasonCode: normalized.reasonCode,
      sourceId: normalized.sourceId,
    },
    select: { amount: true },
  });
  if (
    existing.length !== amountChunks.length
    || existing.reduce((sum, entry) => sum + BigInt(entry.amount), 0n)
      !== BigInt(normalized.amount)
  ) {
    throw new StudyPointsError(
      "POINTS_LEGACY_IMPORT_MISMATCH",
      "Imported legacy point row does not match its preserved PointsLog source.",
    );
  }
  return created;
}

export async function getStudyPointsLegacyImportAudit(
  userId: string,
  database: PrismaClient = getPrisma() as PrismaClient,
): Promise<StudyPointsLegacyImportAudit> {
  const [
    user,
    marker,
    statsRows,
    orphanRowsResult,
    adjustmentRows,
    legacyKinds,
  ] =
    await Promise.all([
      database.user.findUnique({
        where: { id: userId },
        select: { id: true, totalPoints: true },
      }),
      database.studyPointsLegacyCutover.findUnique({ where: { userId } }),
      database.$queryRaw<Array<{
        pointsLogTotal: string;
        pointsLogRowCount: string;
        expectedRows: string;
        importedRows: string;
        missingRows: string;
        importedPoints: string;
        invalidRows: string;
      }>>`
        WITH per_log AS (
          SELECT
            log."id",
            log."points",
            log."createdAt",
            COUNT(entry."id")::bigint AS "entryCount",
            COALESCE(SUM(entry."amount"), 0)::bigint AS "entryPoints",
            COALESCE(BOOL_AND(
              entry."category" = 'LEGACY'
              AND entry."ruleVersion" = ${LEGACY_POINTS_RULE_VERSION}
              AND entry."effectiveAt" = log."createdAt"
              AND entry."reversalOfEntryId" IS NULL
              AND entry."amount" <> 0
              AND ABS(entry."amount") <= ${STUDY_POINTS_MAX_ENTRY_AMOUNT}
              AND SIGN(entry."amount") = SIGN(log."points")
            ) FILTER (WHERE entry."id" IS NOT NULL), TRUE) AS "validEntries"
          FROM "PointsLog" AS log
          LEFT JOIN "StudyPointsLedgerEntry" AS entry
            ON entry."userId" = log."userId"
            AND entry."sourceType" = 'LEGACY_POINTS_LOG'
            AND entry."reasonCode" = ${LEGACY_LOG_REASON}
            AND entry."sourceId" = log."id"
          WHERE log."userId" = ${userId}
          GROUP BY log."id", log."points", log."createdAt"
        )
        SELECT
          COALESCE((SELECT SUM("points") FROM "PointsLog" WHERE "userId" = ${userId}), 0)::text
            AS "pointsLogTotal",
          COUNT(*) FILTER (WHERE "points" <> 0)::text AS "pointsLogRowCount",
          COUNT(*) FILTER (WHERE "points" <> 0)::text AS "expectedRows",
          COUNT(*) FILTER (
            WHERE "points" <> 0
              AND "entryPoints" = "points"
              AND "entryCount" = CEIL(ABS("points")::numeric / ${STUDY_POINTS_MAX_ENTRY_AMOUNT})
              AND "validEntries"
          )::text AS "importedRows",
          COUNT(*) FILTER (
            WHERE "points" <> 0
              AND NOT (
                "entryPoints" = "points"
                AND "entryCount" = CEIL(ABS("points")::numeric / ${STUDY_POINTS_MAX_ENTRY_AMOUNT})
                AND "validEntries"
              )
          )::text AS "missingRows",
          COALESCE(SUM("entryPoints"), 0)::text AS "importedPoints",
          COUNT(*) FILTER (
            WHERE ("points" = 0 AND "entryCount" > 0)
              OR ("entryCount" > 0 AND NOT "validEntries")
          )::text AS "invalidRows"
        FROM per_log
      `,
      database.$queryRaw<Array<{ count: string }>>`
        SELECT COUNT(*)::text AS count
        FROM "StudyPointsLedgerEntry" AS entry
        WHERE entry."userId" = ${userId}
          AND entry."sourceType" = 'LEGACY_POINTS_LOG'
          AND entry."reasonCode" = ${LEGACY_LOG_REASON}
          AND NOT EXISTS (
            SELECT 1
            FROM "PointsLog" AS log
            WHERE log."userId" = entry."userId"
              AND log."id" = entry."sourceId"
          )
      `,
      database.$queryRaw<Array<{
        amount: string;
        count: string;
        invalidCount: string;
      }>>`
        SELECT
          COALESCE(SUM(entry."amount"), 0)::text AS amount,
          COUNT(*)::text AS count,
          COUNT(*) FILTER (
            WHERE entry."category" <> 'LEGACY'
              OR entry."ruleVersion" <> ${LEGACY_POINTS_RULE_VERSION}
              OR entry."reversalOfEntryId" IS NOT NULL
              OR entry."sourceId" IS DISTINCT FROM ${userId}
              OR entry."effectiveAt" <> cutover."capturedAt"
              OR entry."amount" = 0
              OR ABS(entry."amount") > ${STUDY_POINTS_MAX_ENTRY_AMOUNT}
              OR SIGN(entry."amount") <> SIGN(cutover."legacyAdjustment")
          )::text AS "invalidCount"
        FROM "StudyPointsLedgerEntry" AS entry
        INNER JOIN "StudyPointsLegacyCutover" AS cutover
          ON cutover."userId" = entry."userId"
        WHERE entry."userId" = ${userId}
          AND entry."sourceType" = 'LEGACY_POINTS_LOG'
          AND entry."reasonCode" = ${LEGACY_ADJUSTMENT_REASON}
      `,
      database.$queryRaw<Array<{
        baselineCount: string;
        unsupportedCount: string;
      }>>`
        SELECT
          COUNT(*) FILTER (WHERE "reasonCode" = ${LEGACY_BASELINE_REASON})::text
            AS "baselineCount",
          COUNT(*) FILTER (
            WHERE "reasonCode" NOT IN (
              ${LEGACY_BASELINE_REASON},
              ${LEGACY_LOG_REASON},
              ${LEGACY_ADJUSTMENT_REASON}
            )
          )::text AS "unsupportedCount"
        FROM "StudyPointsLedgerEntry"
        WHERE "userId" = ${userId}
          AND "sourceType" = 'LEGACY_POINTS_LOG'
      `,
    ]);

  const stats = statsRows[0];
  const adjustment = adjustmentRows[0];
  const kinds = legacyKinds[0];
  const pointsLogTotal = BigInt(stats?.pointsLogTotal ?? "0");
  const expectedAdjustment = user
    ? BigInt(user.totalPoints) - pointsLogTotal
    : 0n;
  const importedAdjustment = BigInt(adjustment?.amount ?? "0");
  const expectedAdjustmentRows = chunks(
    safeBigIntNumber(
      expectedAdjustment,
      "Legacy user balance adjustment exceeds the safe integer range.",
    ),
  ).length;
  const importedAdjustmentRows = Number(adjustment?.count ?? "0");
  const invalidAdjustmentRows = Number(adjustment?.invalidCount ?? "0");
  const unsupportedBaselineRows = Number(kinds?.baselineCount ?? "0");
  const unsupportedLegacyRows = Number(kinds?.unsupportedCount ?? "0");
  const importedRows = Number(stats?.importedRows ?? "0");
  const missingRows = Number(stats?.missingRows ?? "0");
  const invalidPointLogRows = Number(stats?.invalidRows ?? "0");
  const orphanPointLogImports = Number(orphanRowsResult[0]?.count ?? "0");
  const sourceSnapshotMatches = Boolean(
    user
    && marker
    && marker.legacyUserPoints === user.totalPoints
    && marker.legacyPointsLogTotal === pointsLogTotal
    && marker.legacyPointsLogRowCount === BigInt(stats?.pointsLogRowCount ?? "0")
    && marker.legacyAdjustment === expectedAdjustment,
  );
  const complete = Boolean(
    user
    && marker
    && sourceSnapshotMatches
    && missingRows === 0
    && orphanPointLogImports === 0
    && invalidAdjustmentRows === 0
    && importedAdjustmentRows === expectedAdjustmentRows
    && importedAdjustment === expectedAdjustment
    && invalidPointLogRows === 0
    && unsupportedBaselineRows === 0
    && unsupportedLegacyRows === 0,
  );

  return {
    userId,
    userExists: Boolean(user),
    markerExists: Boolean(marker),
    markerStatus: marker?.status ?? null,
    legacyUserPoints: user?.totalPoints ?? 0,
    pointsLogTotal: safeStudyPointsAggregate(pointsLogTotal),
    pointsLogRowCount: Number(stats?.pointsLogRowCount ?? "0"),
    importedPointLogRows: importedRows,
    missingPointLogRows: missingRows,
    invalidPointLogRows,
    orphanPointLogImports,
    importedPointLogPoints: safeStudyPointsAggregate(stats?.importedPoints ?? "0"),
    legacyAdjustment: safeBigIntNumber(
      expectedAdjustment,
      "Legacy user balance adjustment exceeds the safe integer range.",
    ),
    importedAdjustment: safeStudyPointsAggregate(importedAdjustment),
    invalidAdjustmentRows,
    unsupportedBaselineRows,
    unsupportedLegacyRows,
    sourceSnapshotMatches,
    complete,
  };
}

export async function backfillStudyPointsLegacyBatch(input: {
  userId: string;
  batchSize?: number;
}, database: PrismaClient = getPrisma() as PrismaClient): Promise<StudyPointsLegacyBackfillBatchResult> {
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw new StudyPointsError(
      "POINTS_INVALID_SOURCE",
      "Legacy points backfill batch size must be between 1 and 1000.",
    );
  }

  const result = await database.$transaction(async (tx) => {
    await lockStudyPointsKeys(tx, [
      studyPointsBalanceProjectionLockKey(input.userId),
    ]);
    const baselineCount = await tx.studyPointsLedgerEntry.count({
      where: {
        userId: input.userId,
        sourceType: "LEGACY_POINTS_LOG",
        reasonCode: LEGACY_BASELINE_REASON,
      },
    });
    if (baselineCount > 0) {
      throw new StudyPointsError(
        "POINTS_LEGACY_BASELINE_CONFLICT",
        "Aggregate legacy baselines cannot be safely mixed with row-level PointLog history.",
      );
    }

    const marker = await ensureCutoverMarker(tx, input.userId);
    await importUserAdjustment(tx, marker);
    const rows = await tx.$queryRaw<LegacyLogRow[]>`
      SELECT log."id", log."userId", log."points", log."reason", log."createdAt"
      FROM "PointsLog" AS log
      WHERE log."userId" = ${input.userId}
        AND log."points" <> 0
        AND ((
            SELECT COUNT(*)
            FROM "StudyPointsLedgerEntry" AS entry
            WHERE entry."userId" = log."userId"
              AND entry."sourceType" = 'LEGACY_POINTS_LOG'
              AND entry."reasonCode" = ${LEGACY_LOG_REASON}
              AND entry."sourceId" = log."id"
          ) <> CEIL(ABS(log."points")::numeric / ${STUDY_POINTS_MAX_ENTRY_AMOUNT})
          OR (
            SELECT COALESCE(SUM(entry."amount"), 0)
            FROM "StudyPointsLedgerEntry" AS entry
            WHERE entry."userId" = log."userId"
              AND entry."sourceType" = 'LEGACY_POINTS_LOG'
              AND entry."reasonCode" = ${LEGACY_LOG_REASON}
              AND entry."sourceId" = log."id"
          ) <> log."points"
          OR EXISTS (
            SELECT 1
            FROM "StudyPointsLedgerEntry" AS entry
            WHERE entry."userId" = log."userId"
              AND entry."sourceType" = 'LEGACY_POINTS_LOG'
              AND entry."reasonCode" = ${LEGACY_LOG_REASON}
              AND entry."sourceId" = log."id"
              AND (
                entry."category" <> 'LEGACY'
                OR entry."ruleVersion" <> ${LEGACY_POINTS_RULE_VERSION}
                OR entry."effectiveAt" <> log."createdAt"
                OR entry."reversalOfEntryId" IS NOT NULL
                OR entry."amount" = 0
                OR ABS(entry."amount") > ${STUDY_POINTS_MAX_ENTRY_AMOUNT}
                OR SIGN(entry."amount") <> SIGN(log."points")
              )
          ))
      ORDER BY log."id" ASC
      LIMIT ${batchSize}
    `;
    let importedPointLogRows = 0;
    let importedLedgerEntries = 0;
    for (const row of rows) {
      const createdEntries = await importLegacyLog(tx, row);
      importedLedgerEntries += createdEntries;
      if (createdEntries > 0) importedPointLogRows += 1;
    }
    const [remaining] = await tx.$queryRaw<Array<{ count: string }>>`
      SELECT COUNT(*)::text AS count
      FROM "PointsLog" AS log
      WHERE log."userId" = ${input.userId}
        AND log."points" <> 0
        AND ((
            SELECT COUNT(*)
            FROM "StudyPointsLedgerEntry" AS entry
            WHERE entry."userId" = log."userId"
              AND entry."sourceType" = 'LEGACY_POINTS_LOG'
              AND entry."reasonCode" = ${LEGACY_LOG_REASON}
              AND entry."sourceId" = log."id"
          ) <> CEIL(ABS(log."points")::numeric / ${STUDY_POINTS_MAX_ENTRY_AMOUNT})
          OR (
            SELECT COALESCE(SUM(entry."amount"), 0)
            FROM "StudyPointsLedgerEntry" AS entry
            WHERE entry."userId" = log."userId"
              AND entry."sourceType" = 'LEGACY_POINTS_LOG'
              AND entry."reasonCode" = ${LEGACY_LOG_REASON}
              AND entry."sourceId" = log."id"
          ) <> log."points"
          OR EXISTS (
            SELECT 1
            FROM "StudyPointsLedgerEntry" AS entry
            WHERE entry."userId" = log."userId"
              AND entry."sourceType" = 'LEGACY_POINTS_LOG'
              AND entry."reasonCode" = ${LEGACY_LOG_REASON}
              AND entry."sourceId" = log."id"
              AND (
                entry."category" <> 'LEGACY'
                OR entry."ruleVersion" <> ${LEGACY_POINTS_RULE_VERSION}
                OR entry."effectiveAt" <> log."createdAt"
                OR entry."reversalOfEntryId" IS NOT NULL
                OR entry."amount" = 0
                OR ABS(entry."amount") > ${STUDY_POINTS_MAX_ENTRY_AMOUNT}
                OR SIGN(entry."amount") <> SIGN(log."points")
              )
          ))
    `;
    return {
      importedPointLogRows,
      importedLedgerEntries,
      remainingPointLogRows: Number(remaining?.count ?? "0"),
      markerUserId: marker.userId,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5_000,
    timeout: 30_000,
  });

  const reconciliation = result.remainingPointLogRows === 0
    ? await reconcileStudyPointsAccount({
      userId: input.userId,
      repairProjection: true,
    }, database)
    : undefined;
  const audit = await getStudyPointsLegacyImportAudit(input.userId, database);
  const projectionReady = reconciliation?.status === "IN_SYNC"
    || (
      reconciliation?.status === "PROJECTION_MISSING"
      && reconciliation.canonical.ledgerEntryCount === 0
    );
  const cutoverStatus = audit.complete && projectionReady
    ? "COMPLETED"
    : "PENDING";
  await database.studyPointsLegacyCutover.update({
    where: { userId: result.markerUserId },
    data: {
      status: cutoverStatus,
      completedAt: audit.complete ? new Date() : null,
    },
  });
  return {
    userId: input.userId,
    importedPointLogRows: result.importedPointLogRows,
    importedLedgerEntries: result.importedLedgerEntries,
    remainingPointLogRows: result.remainingPointLogRows,
    cutoverStatus,
  };
}
