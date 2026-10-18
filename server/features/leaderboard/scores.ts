import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import {
  clampStudyPointsRangeStart,
  getStudyPointsCompetitiveEpoch,
} from "../study-points/epoch.js";
import { LeaderboardError } from "./errors.js";
import type { LeaderboardSeasonWindow } from "./periods.js";
import type { LeaderboardScope, StudyPointsCompatibilityMode } from "./types.js";

type Transaction = Prisma.TransactionClient;
type RankedRow = {
  userId: string | null;
  score: string | null;
  rank: number | null;
  tieSize: number | null;
  ruleVersions: string[];
};

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

function decodeRows(rows: readonly RankedRow[]) {
  const ruleVersions = rows[0]?.ruleVersions ?? [];
  return {
    rows: rows.flatMap((row) => {
      if (
        row.userId === null
        || row.score === null
        || row.rank === null
        || row.tieSize === null
      ) return [];
      return [{
        userId: row.userId,
        score: decodeScore(row.score),
        rank: row.rank,
        tieSize: row.tieSize,
      }];
    }),
    ruleVersions,
  };
}

async function readRankedScores(
  tx: Transaction,
  startsAt: Date,
  scoreThrough: Date,
): Promise<ReturnType<typeof decodeRows>> {
  const rangeStart = clampStudyPointsRangeStart(startsAt);
  const rows = await tx.$queryRaw<RankedRow[]>`
    WITH period_points AS (
      SELECT
        entry."userId",
        entry."amount"::bigint AS points,
        entry."ruleVersion"
      FROM "StudyPointsLedgerEntry" AS entry
      WHERE entry."effectiveAt" >= ${rangeStart}
        AND entry."effectiveAt" < ${scoreThrough}
        AND entry."sourceType" <> 'LEGACY_POINTS_LOG'
        AND entry."category" <> 'LEGACY'
    ),
    scores AS (
      SELECT "userId", SUM(points)::bigint AS score
      FROM period_points
      GROUP BY "userId"
    ),
    eligible AS (
      SELECT
        account."id" AS "userId",
        GREATEST(COALESCE(scores.score, 0), 0)::bigint AS score
      FROM "User" AS account
      LEFT JOIN scores ON scores."userId" = account."id"
      WHERE account."createdAt" <= ${scoreThrough}
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
  return decodeRows(rows);
}

export async function readRankedLeaderboardScores(input: {
  scope: LeaderboardScope;
  season: LeaderboardSeasonWindow;
  scoreThrough: Date;
  compatibilityMode?: StudyPointsCompatibilityMode;
}, tx: Transaction): Promise<{
  rows: Array<{ userId: string; score: bigint; rank: number; tieSize: number }>;
  ruleVersions: string[];
  compatibilityMode: StudyPointsCompatibilityMode | null;
}> {
  const { scope, season, scoreThrough } = input;
  if (!(scoreThrough instanceof Date) || !Number.isFinite(scoreThrough.getTime())) {
    throw new LeaderboardError(
      "LEADERBOARD_INVALID_INPUT",
      "Leaderboard score-through time is invalid.",
    );
  }

  if (scope === "ALL_TIME") {
    const result = await readRankedScores(
      tx,
      getStudyPointsCompetitiveEpoch(),
      scoreThrough,
    );
    return {
      ...result,
      compatibilityMode: "LEDGER_ONLY",
    };
  }

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
  const result = await readRankedScores(tx, season.startsAt, scoreThrough);
  return { ...result, compatibilityMode: null };
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
    let startsAt: Date;
    let compatibilityMode: StudyPointsCompatibilityMode | null = null;

    if (input.scope === "ALL_TIME") {
      startsAt = getStudyPointsCompetitiveEpoch();
      compatibilityMode = "LEDGER_ONLY";
    } else {
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
      startsAt = clampStudyPointsRangeStart(input.season.startsAt);
    }

    const [totals] = await tx.$queryRaw<Array<{ score: string }>>`
      SELECT COALESCE(SUM("amount"), 0)::text AS score
      FROM "StudyPointsLedgerEntry"
      WHERE "userId" = ${input.userId}
        AND "effectiveAt" >= ${startsAt}
        AND "effectiveAt" < ${input.scoreThrough}
        AND "sourceType" <> 'LEGACY_POINTS_LOG'
        AND "category" <> 'LEGACY'
    `;
    return {
      score: Number(decodeScore(totals?.score ?? "0")),
      compatibilityMode,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export function decodeLeaderboardScore(value: bigint): number {
  return Number(decodeScore(value));
}
