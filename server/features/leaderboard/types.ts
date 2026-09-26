export const LEADERBOARD_SCOPES = [
  "WEEKLY",
  "MONTHLY",
  "SEMESTER",
  "ALL_TIME",
] as const;

export type LeaderboardScope = typeof LEADERBOARD_SCOPES[number];
export type LeaderboardSnapshotType = "LIVE" | "FINAL";
export type LeaderboardSeasonStatus = "UPCOMING" | "ACTIVE" | "CLOSED";
export type StudyPointsCompatibilityMode =
  | "LEGACY_ONLY"
  | "LEGACY_PLUS_LEDGER"
  | "LEDGER_ONLY";

export type RankedScore = {
  userId: string;
  score: bigint;
  rank: number;
  tieSize: number;
  levelSnapshot: number | null;
};

export type PublicLeaderboardEntry = {
  rank: number;
  tieSize: number;
  userId: string;
  level: number | null;
  score: number;
};

export type LeaderboardCursorPayload = {
  version: 1;
  snapshotId: string;
  seasonId: string;
  rank: number;
  score: string;
  userId: string;
  expiresAt: number | null;
};

export type LeaderboardSnapshotCheck = {
  code:
    | "SNAPSHOT_MISSING"
    | "ENTRY_COUNT_MISMATCH"
    | "SCORE_MISMATCH"
    | "RANK_MISMATCH"
    | "TIE_SIZE_MISMATCH"
    | "SOURCE_FINGERPRINT_MISMATCH"
    | "FINAL_SNAPSHOT_MISSING"
    | "MULTIPLE_FINAL_SNAPSHOTS"
    | "SEASON_STATUS_MISMATCH";
  status: "PASS" | "FAIL";
  occurrences: number;
};