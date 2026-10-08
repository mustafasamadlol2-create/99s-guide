import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { resolveStudyPointsReadMode } from "../study-points/readModel.js";
import { LeaderboardError } from "./errors.js";
import type { LeaderboardSeasonWindow } from "./periods.js";
import type { LeaderboardScope, StudyPointsCompatibilityMode } from "./types.js";

type Transaction = Prisma.TransactionClient;
type ScoreRow = { userId: string; score: string };
type RankedRow = {
  userId: string;
  score: string;
  rank: number;
  tieSize: number;
};
type RankedRowWithVersions = {
  userId: string | null;
  score: string | null;
  rank: number | null;
  tieSize: number | null;
  ruleVersions: string[];
};

function splitRankedRows(rows: readonly RankedRowWithVersions[]): {
  rows: RankedRow[];
  ruleVersions: string[];
} {
  return {
    rows: rows.flatMap((row): RankedRow[] => {
      if (
        row.userId === null
        || row.score === null
        || row.rank === null
        || row.tieSize === null
      ) {
        return [];
      }
      return [{
        userId: row.userId,
        score: row.score,
        rank: row.rank,
        tieSize: row.tieSize,
      }];
    }),
    ruleVersions: rows[0]?.ruleVersions ?? [],
  };
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

function decodeScore(value: string | bigint): bigint {
  try {
    const score = typeof value === "bigint" ? value : BigInt(value);
    if (score > MAX_SAFE || score < MIN_SAFE) {
      throw new LeaderboardError(
        "LEADERBOARD_AGGREGATE_OVERFLOW",
        "Leaderboard score exceeds the safe integer range.",
      );
    }
    return score;
  } catch (error) {
    if (error instanceof LeaderboardError) throw error;
    throw new LeaderboardError(
      "LEADERBOARD_AGGREGATE_OVERFLOW",
      "Leaderboard score could not be represented as an integer.",
    );
  }
}

async function assertCompatibleLifetimeRead(
  tx: Transaction,
  mode: StudyPointsCompatibilityMode,
): Promise<void> {
  if (mode !== "LEDGER_ONLY") return;
  const [status] = await tx.$queryRaw<Array<{ ready: boolean }>>`
    WITH log_totals AS (
      SELECT
        "userId",
        COALESCE(SUM("points"), 0)::bigint AS points,
        COUNT(*) FILTER (WHERE "points" <> 0)::bigint AS rows
      FROM "PointsLog"
      GROUP BY "userId"
    ),
    row_coverage AS (
      SELECT
        log."userId",
        log."id",
        log."points",
        log."createdAt",
        COUNT(entry."id")::bigint AS entry_count,
        COALESCE(SUM(entry."amount"), 0)::bigint AS entry_points,
        COALESCE(BOOL_AND(
          entry."category" = 'LEGACY'
          AND entry."ruleVersion" = 'legacy-pointslog-v1'
          AND entry."effectiveAt" = log."createdAt"
          AND entry."reversalOfEntryId" IS NULL
          AND entry."amount" <> 0
          AND ABS(entry."amount") <= 100000
          AND SIGN(entry."amount") = SIGN(log."points")
        ) FILTER (WHERE entry."id" IS NOT NULL), TRUE) AS valid_entries
      FROM "PointsLog" AS log
      LEFT JOIN "StudyPointsLedgerEntry" AS entry
        ON entry."userId" = log."userId"
        AND entry."sourceType" = 'LEGACY_POINTS_LOG'
        AND entry."reasonCode" = 'legacy.points_log'
        AND entry."sourceId" = log."id"
      WHERE log."points" <> 0
      GROUP BY log."userId", log."id", log."points", log."createdAt"
    ),
    adjustments AS (
      SELECT
        entry."userId",
        COALESCE(SUM(entry."amount"), 0)::bigint AS points,
        COUNT(*)::bigint AS entries,
        COALESCE(BOOL_AND(
          entry."category" = 'LEGACY'
          AND entry."ruleVersion" = 'legacy-pointslog-v1'
          AND entry."reversalOfEntryId" IS NULL
          AND entry."sourceId" = entry."userId"
          AND entry."effectiveAt" = cutover."capturedAt"
        ), TRUE) AS valid_entries
      FROM "StudyPointsLedgerEntry" AS entry
      INNER JOIN "StudyPointsLegacyCutover" AS cutover
        ON cutover."userId" = entry."userId"
      WHERE entry."sourceType" = 'LEGACY_POINTS_LOG'
        AND entry."reasonCode" = 'legacy.user_total_adjustment'
      GROUP BY entry."userId", cutover."capturedAt"
    ),
    blockers AS (
      SELECT 1
      FROM "StudyPointsLedgerEntry"
      WHERE "sourceType" = 'LEGACY_POINTS_LOG'
        AND "reasonCode" = 'legacy.baseline_import'
      UNION ALL
      SELECT 1
      FROM "User" AS account
      LEFT JOIN "StudyPointsLegacyCutover" AS cutover
        ON cutover."userId" = account."id"
      LEFT JOIN log_totals AS logs ON logs."userId" = account."id"
      WHERE (
        account."totalPoints" <> 0
        OR COALESCE(logs.rows, 0) > 0
      ) AND (
        cutover."userId" IS NULL
        OR cutover."status" <> 'COMPLETED'
        OR cutover."legacyUserPoints" <> account."totalPoints"
        OR cutover."legacyPointsLogTotal" <> COALESCE(logs.points, 0)
        OR cutover."legacyPointsLogRowCount" <> COALESCE(logs.rows, 0)
        OR cutover."legacyAdjustment"
          <> account."totalPoints" - COALESCE(logs.points, 0)
      )
      UNION ALL
      SELECT 1
      FROM row_coverage
      WHERE "entry_points" <> "points"
        OR "entry_count" <> CEIL(ABS("points")::numeric / 100000)
        OR NOT valid_entries
      UNION ALL
      SELECT 1
      FROM "StudyPointsLedgerEntry" AS entry
      WHERE entry."sourceType" = 'LEGACY_POINTS_LOG'
        AND entry."reasonCode" = 'legacy.points_log'
        AND NOT EXISTS (
          SELECT 1 FROM "PointsLog" AS log
          WHERE log."userId" = entry."userId"
            AND log."id" = entry."sourceId"
        )
      UNION ALL
      SELECT 1
      FROM "User" AS account
      LEFT JOIN log_totals AS logs ON logs."userId" = account."id"
      LEFT JOIN adjustments
        ON adjustments."userId" = account."id"
      LEFT JOIN "StudyPointsLegacyCutover" AS cutover
        ON cutover."userId" = account."id"
      WHERE (
        account."totalPoints" <> 0
        OR COALESCE(logs.rows, 0) > 0
      ) AND (
        COALESCE(adjustments.points, 0)
          <> account."totalPoints" - COALESCE(logs.points, 0)
        OR COALESCE(adjustments.entries, 0)
          <> CEIL(ABS(account."totalPoints" - COALESCE(logs.points, 0))::numeric / 100000)
        OR NOT COALESCE(adjustments.valid_entries, TRUE)
        OR (
          cutover."userId" IS NOT NULL
          AND cutover."legacyAdjustment"
            <> account."totalPoints" - COALESCE(logs.points, 0)
        )
      )
      UNION ALL
      SELECT 1
      FROM "StudyPointsLedgerEntry"
      WHERE "sourceType" = 'LEGACY_POINTS_LOG'
        AND "reasonCode" NOT IN (
          'legacy.baseline_import',
          'legacy.points_log',
          'legacy.user_total_adjustment'
        )
    )
    SELECT NOT EXISTS (SELECT 1 FROM blockers) AS ready
  `;
  if (!status?.ready) {
    throw new LeaderboardError(
      "LEADERBOARD_POINTS_LEDGER_ONLY_NOT_READY",
      "Leaderboard ledger-only mode is not ready until legacy balances and history are fully reconciled.",
    );
  }
}

async function readBoundedRankedScores(
  tx: Transaction,
  startsAt: Date,
  scoreThrough: Date,
): Promise<{ rows: RankedRow[]; ruleVersions: string[] }> {
  const rows = await tx.$queryRaw<RankedRowWithVersions[]>`
    WITH period_points AS (
      SELECT
        entry."userId",
        entry."amount"::bigint AS points,
        entry."ruleVersion"
      FROM "StudyPointsLedgerEntry" AS entry
      WHERE entry."effectiveAt" >= ${startsAt}
        AND entry."effectiveAt" < ${scoreThrough}
        AND entry."reasonCode" NOT IN (
          'legacy.user_total_adjustment',
          'legacy.baseline_import'
        )
      UNION ALL
      SELECT
        log."userId",
        log."points"::bigint AS points,
        'legacy-pointslog-v1'::text AS "ruleVersion"
      FROM "PointsLog" AS log
      WHERE log."points" <> 0
        AND log."createdAt" >= ${startsAt}
        AND log."createdAt" < ${scoreThrough}
        AND NOT EXISTS (
          SELECT 1
          FROM "StudyPointsLedgerEntry" AS imported
          WHERE imported."userId" = log."userId"
            AND imported."sourceType" = 'LEGACY_POINTS_LOG'
            AND imported."reasonCode" = 'legacy.points_log'
            AND imported."sourceId" = log."id"
        )
    ),
    scores AS (
      SELECT "userId", SUM(points)::bigint AS score
      FROM period_points
      GROUP BY "userId"
    ),
    eligible AS (
      SELECT scores."userId", scores.score
      FROM scores
      INNER JOIN "User" AS account ON account."id" = scores."userId"
      WHERE scores.score > 0
        AND account."accountStatus" = 'ACTIVE'
    ),
    ranked AS (
      SELECT
        eligible."userId",
        eligible.score,
        RANK() OVER (ORDER BY eligible.score DESC)::integer AS rank,
        COUNT(*) OVER (PARTITION BY eligible.score)::integer AS "tieSize"
      FROM eligible
    ),
    versions AS (
      SELECT COALESCE(
        ARRAY(
           SELECT DISTINCT period_points."ruleVersion"
           FROM period_points
           INNER JOIN eligible ON eligible."userId" = period_points."userId"
           ORDER BY period_points."ruleVersion"
        ),
        ARRAY[]::text[]
      ) AS "ruleVersions"
    )
    SELECT ranked."userId", ranked.score::text AS score,
      ranked.rank, ranked."tieSize", versions."ruleVersions"
    FROM versions
    LEFT JOIN ranked ON TRUE
    ORDER BY ranked.rank ASC, ranked.score DESC, ranked."userId" ASC
  `;
  return splitRankedRows(rows);
}

async function readLifetimeRankedScores(
  tx: Transaction,
  mode: StudyPointsCompatibilityMode,
  scoreThrough: Date,
): Promise<{ rows: RankedRow[]; ruleVersions: string[] }> {
  await assertCompatibleLifetimeRead(tx, mode);
  const legacyRows = mode === "LEDGER_ONLY"
    ? Prisma.sql``
    : Prisma.sql`
      SELECT "id" AS "userId", "totalPoints"::bigint AS score
      FROM "User"
      WHERE "createdAt" <= ${scoreThrough}
    `;
  const ledgerRows = mode === "LEGACY_ONLY"
    ? Prisma.sql``
    : Prisma.sql`
      SELECT "userId", SUM("amount")::bigint AS score
      FROM "StudyPointsLedgerEntry"
      WHERE "effectiveAt" <= ${scoreThrough}
        ${mode === "LEGACY_PLUS_LEDGER"
          ? Prisma.sql`AND "sourceType" <> 'LEGACY_POINTS_LOG'`
          : Prisma.empty}
      GROUP BY "userId"
    `;
  const combined = mode === "LEGACY_ONLY"
    ? Prisma.sql`
      SELECT "userId", score
      FROM (${legacyRows}) AS legacy
    `
    : mode === "LEDGER_ONLY"
      ? Prisma.sql`
        SELECT "userId", score
        FROM (${ledgerRows}) AS ledger
      `
      : Prisma.sql`
        SELECT COALESCE(legacy."userId", ledger."userId") AS "userId",
          (COALESCE(legacy.score, 0) + COALESCE(ledger.score, 0))::bigint AS score
        FROM (${legacyRows}) AS legacy
        FULL OUTER JOIN (${ledgerRows}) AS ledger
          ON ledger."userId" = legacy."userId"
      `;
  const versions = mode === "LEGACY_ONLY"
    ? Prisma.sql`SELECT ARRAY[]::text[] AS "ruleVersions"`
    : Prisma.sql`
      SELECT COALESCE(
        ARRAY(
           SELECT DISTINCT entry."ruleVersion"
          FROM "StudyPointsLedgerEntry" AS entry
          INNER JOIN eligible ON eligible."userId" = entry."userId"
           WHERE entry."effectiveAt" <= ${scoreThrough}
             ${mode === "LEGACY_PLUS_LEDGER"
               ? Prisma.sql`AND entry."sourceType" <> 'LEGACY_POINTS_LOG'`
               : Prisma.empty}
          ORDER BY entry."ruleVersion"
        ),
        ARRAY[]::text[]
      ) AS "ruleVersions"
    `;
  const rows = await tx.$queryRaw<RankedRowWithVersions[]>(Prisma.sql`
    WITH combined AS (${combined}),
    eligible AS (
      SELECT combined."userId", combined.score
      FROM combined
      INNER JOIN "User" AS account ON account."id" = combined."userId"
      WHERE combined.score > 0
        AND account."accountStatus" = 'ACTIVE'
    ),
    ranked AS (
      SELECT
        eligible."userId",
        eligible.score,
        RANK() OVER (ORDER BY eligible.score DESC)::integer AS rank,
        COUNT(*) OVER (PARTITION BY eligible.score)::integer AS "tieSize"
      FROM eligible
    ),
    versions AS (${versions})
    SELECT ranked."userId", ranked.score::text AS score,
      ranked.rank, ranked."tieSize", versions."ruleVersions"
    FROM versions
    LEFT JOIN ranked ON TRUE
    ORDER BY ranked.rank ASC, ranked.score DESC, ranked."userId" ASC
  `);
  return splitRankedRows(rows);
}

export async function readRankedLeaderboardScores(input: {
  scope: LeaderboardScope;
  season: LeaderboardSeasonWindow;
  scoreThrough: Date;
  compatibilityMode?: StudyPointsCompatibilityMode;
}, tx: Transaction): Promise<{
  rows: Array<Omit<RankedRow, "score"> & { score: bigint }>;
  ruleVersions: string[];
  compatibilityMode: StudyPointsCompatibilityMode | null;
}> {
  const { scope, season, scoreThrough } = input;
  let rawRows: RankedRow[];
  let ruleVersions: string[];
  let compatibilityMode: StudyPointsCompatibilityMode | null = null;
  if (scope === "ALL_TIME") {
    compatibilityMode = input.compatibilityMode ?? resolveStudyPointsReadMode();
    const result = await readLifetimeRankedScores(tx, compatibilityMode, scoreThrough);
    rawRows = result.rows;
    ruleVersions = result.ruleVersions;
  } else {
    if (!season.startsAt || !season.endsAt) {
      throw new LeaderboardError(
        "LEADERBOARD_INVALID_INPUT",
        "Time-bounded leaderboard season is missing a boundary.",
      );
    }
    if (scoreThrough < season.startsAt || scoreThrough > season.endsAt) {
      throw new LeaderboardError(
        "LEADERBOARD_INVALID_INPUT",
        "Leaderboard score-through time is outside the season window.",
      );
    }
    const result = await readBoundedRankedScores(tx, season.startsAt, scoreThrough);
    rawRows = result.rows;
    ruleVersions = result.ruleVersions;
  }
  return {
    rows: rawRows.map((row) => ({
      userId: row.userId,
      score: decodeScore(row.score),
      rank: row.rank,
      tieSize: row.tieSize,
    })),
    ruleVersions,
    compatibilityMode,
  };
}

export async function readUserLeaderboardScore(input: {
  userId: string;
  scope: LeaderboardScope;
  season: LeaderboardSeasonWindow;
  scoreThrough: Date;
  compatibilityMode?: StudyPointsCompatibilityMode;
}, database: PrismaClient = getPrisma() as PrismaClient): Promise<{
  score: number;
  compatibilityMode: StudyPointsCompatibilityMode | null;
}> {
  return database.$transaction(async (tx) => {
    if (input.scope === "ALL_TIME") {
      const mode = input.compatibilityMode ?? resolveStudyPointsReadMode();
      await assertCompatibleLifetimeRead(tx, mode);
      const totals = await tx.$queryRaw<Array<{ legacy: string; ledger: string }>>`
        SELECT
          COALESCE((
            SELECT "totalPoints"::bigint
            FROM "User"
            WHERE "id" = ${input.userId}
              AND "createdAt" <= ${input.scoreThrough}
          ), 0)::text AS legacy,
          COALESCE((
            SELECT SUM("amount")::bigint
            FROM "StudyPointsLedgerEntry"
            WHERE "userId" = ${input.userId}
              AND "effectiveAt" <= ${input.scoreThrough}
              ${mode === "LEGACY_PLUS_LEDGER"
                ? Prisma.sql`AND "sourceType" <> 'LEGACY_POINTS_LOG'`
                : Prisma.empty}
          ), 0)::text AS ledger
      `;
      const legacy = mode === "LEDGER_ONLY" ? 0n : BigInt(totals[0]?.legacy ?? "0");
      const ledger = mode === "LEGACY_ONLY" ? 0n : BigInt(totals[0]?.ledger ?? "0");
      const sum = legacy + ledger;
      return {
        score: Number(decodeScore(sum)),
        compatibilityMode: mode,
      };
    }
    if (!input.season.startsAt || !input.season.endsAt) {
      throw new LeaderboardError(
        "LEADERBOARD_INVALID_INPUT",
        "Time-bounded leaderboard season is missing a boundary.",
      );
    }
    if (
      input.scoreThrough < input.season.startsAt
      || input.scoreThrough > input.season.endsAt
    ) {
      throw new LeaderboardError(
        "LEADERBOARD_INVALID_INPUT",
        "Leaderboard score-through time is outside the season window.",
      );
    }
    const totals = await tx.$queryRaw<Array<{ score: string }>>`
      WITH period_points AS (
        SELECT entry."amount"::bigint AS points
        FROM "StudyPointsLedgerEntry" AS entry
        WHERE entry."userId" = ${input.userId}
          AND entry."effectiveAt" >= ${input.season.startsAt}
          AND entry."effectiveAt" < ${input.scoreThrough}
          AND entry."reasonCode" NOT IN (
            'legacy.user_total_adjustment',
            'legacy.baseline_import'
          )
        UNION ALL
        SELECT log."points"::bigint AS points
        FROM "PointsLog" AS log
        WHERE log."userId" = ${input.userId}
          AND log."points" <> 0
          AND log."createdAt" >= ${input.season.startsAt}
          AND log."createdAt" < ${input.scoreThrough}
          AND NOT EXISTS (
            SELECT 1 FROM "StudyPointsLedgerEntry" AS imported
            WHERE imported."userId" = log."userId"
              AND imported."sourceType" = 'LEGACY_POINTS_LOG'
              AND imported."reasonCode" = 'legacy.points_log'
              AND imported."sourceId" = log."id"
          )
      )
      SELECT COALESCE(SUM(points), 0)::text AS score
      FROM period_points
    `;
    return {
      score: Number(decodeScore(totals[0]?.score ?? "0")),
      compatibilityMode: null,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export function decodeLeaderboardScore(value: bigint): number {
  return Number(decodeScore(value));
}