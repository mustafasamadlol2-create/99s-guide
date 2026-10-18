import { createHash } from "node:crypto";
import { canonicalJson } from "../study-core/canonicalJson.js";
import type { RankedScore } from "./types.js";

export const LEADERBOARD_RANKING_SEMANTICS_VERSION = "leaderboard-ranking-v4-points-v2";
export const LEADERBOARD_ALL_TIME_RANKING_SEMANTICS_VERSION =
  "leaderboard-all-time-ranking-v5-points-v2";

export function getLeaderboardRankingSemanticsVersion(scope: string): string {
  return scope === "ALL_TIME"
    ? LEADERBOARD_ALL_TIME_RANKING_SEMANTICS_VERSION
    : LEADERBOARD_RANKING_SEMANTICS_VERSION;
}

export function hashLeaderboardRuleVersions(versions: readonly string[]): string | null {
  const normalized = [...new Set(versions)].sort();
  if (normalized.length === 0) return null;
  return createHash("sha256")
    .update(canonicalJson(normalized))
    .digest("hex");
}

export function fingerprintLeaderboardSnapshot(input: {
  season: {
    id: string;
    scope: string;
    seasonKey: string;
    startsAt: Date | null;
    endsAt: Date | null;
  };
  scoreThrough: Date;
  rows: readonly RankedScore[];
  pointsRuleVersionSetHash: string | null;
  compatibilityMode: string | null;
}): string {
  const orderedRows = [...input.rows].sort((left, right) =>
    left.rank - right.rank
      || (left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0));
  const totalScore = input.rows.reduce((sum, row) => sum + row.score, 0n);
  const payload = {
    rankingSemanticsVersion: getLeaderboardRankingSemanticsVersion(
      input.season.scope,
    ),
    season: {
      id: input.season.id,
      scope: input.season.scope,
      seasonKey: input.season.seasonKey,
      startsAt: input.season.startsAt?.toISOString() ?? null,
      endsAt: input.season.endsAt?.toISOString() ?? null,
    },
    scoreThrough: input.scoreThrough.toISOString(),
    compatibilityMode: input.compatibilityMode,
    pointsRuleVersionSetHash: input.pointsRuleVersionSetHash,
    entryCount: orderedRows.length,
    totalScore: totalScore.toString(),
    entries: orderedRows.map((row) => ({
      userId: row.userId,
      score: row.score.toString(),
      rank: row.rank,
      tieSize: row.tieSize,
    })),
  };
  return createHash("sha256")
    .update(canonicalJson(payload))
    .digest("hex");
}