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
  if (mode === "LEGACY_PLUS_LEDGER") {
    const baselines = await tx.$queryRaw<Array<{ found: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM "StudyPointsLedgerEntry"
        WHERE "sourceType" = 'LEGACY_POINTS_LOG'
          AND "reasonCode" = 'legacy.baseline_import'
      ) AS found
    `;
    if (baselines[0]?.found) {
      throw new LeaderboardError(
        "LEADERBOARD_POINTS_COMPATIBILITY_CONFLICT",
        "Transitional Study Points mode cannot combine legacy history with a ledger baseline.",
      );
    }
  }
  if (mode === "LEDGER_ONLY") {
    const [baselines, legacyTotals] = await Promise.all([
      tx.$queryRaw<Array<{ found: boolean }>>`
        SELECT EXISTS (
          SELECT 1
          FROM "StudyPointsLedgerEntry"
          WHERE "sourceType" = 'LEGACY_POINTS_LOG'
            AND "reasonCode" = 'legacy.baseline_import'
        ) AS found
      `,
      tx.$queryRaw<Array<{ found: boolean }>>`
        SELECT EXISTS (
          SELECT 1
          FROM "PointsLog"
          GROUP BY "userId"
          HAVING SUM("points") <> 0
        ) AS found
      `,
    ]);
    if (baselines[0]?.found || legacyTotals[0]?.found) {
      throw new LeaderboardError(
        "LEADERBOARD_POINTS_LEDGER_ONLY_NOT_READY",
        "Leaderboard ledger-only mode is not ready while legacy balances remain.",
      );
    }
  }
}

async function readBoundedRankedScores(
  tx: Transaction,
  startsAt: Date,
  scoreThrough: Date,
): Promise<{ rows: RankedRow[]; ruleVersions: string[] }> {
  const rows = await tx.$queryRaw<RankedRowWithVersions[]>`
    WITH scores AS (
      SELECT entry."userId", SUM(entry."amount")::bigint AS score
      FROM "StudyPointsLedgerEntry" AS entry
      WHERE entry."sourceType" <> 'LEGACY_POINTS_LOG'
        AND entry."effectiveAt" >= ${startsAt}
        AND entry."effectiveAt" < ${scoreThrough}
      GROUP BY entry."userId"
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
          SELECT DISTINCT entry."ruleVersion"
          FROM "StudyPointsLedgerEntry" AS entry
          INNER JOIN eligible ON eligible."userId" = entry."userId"
          WHERE entry."sourceType" <> 'LEGACY_POINTS_LOG'
            AND entry."effectiveAt" >= ${startsAt}
            AND entry."effectiveAt" < ${scoreThrough}
          ORDER BY entry."ruleVersion"
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
      SELECT "userId", SUM("points")::bigint AS score
      FROM "PointsLog"
      WHERE "createdAt" <= ${scoreThrough}
      GROUP BY "userId"
    `;
  const ledgerRows = mode === "LEGACY_ONLY"
    ? Prisma.sql``
    : Prisma.sql`
      SELECT "userId", SUM("amount")::bigint AS score
      FROM "StudyPointsLedgerEntry"
      WHERE "createdAt" <= ${scoreThrough}
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
          WHERE entry."createdAt" <= ${scoreThrough}
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
            SELECT SUM("points")::bigint
            FROM "PointsLog"
            WHERE "userId" = ${input.userId}
              AND "createdAt" <= ${input.scoreThrough}
          ), 0)::text AS legacy,
          COALESCE((
            SELECT SUM("amount")::bigint
            FROM "StudyPointsLedgerEntry"
            WHERE "userId" = ${input.userId}
              AND "createdAt" <= ${input.scoreThrough}
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
      SELECT COALESCE(SUM("amount"), 0)::text AS score
      FROM "StudyPointsLedgerEntry"
      WHERE "userId" = ${input.userId}
        AND "sourceType" <> 'LEGACY_POINTS_LOG'
        AND "effectiveAt" >= ${input.season.startsAt}
        AND "effectiveAt" < ${input.scoreThrough}
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