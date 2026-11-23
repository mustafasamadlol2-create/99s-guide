export const LEADERBOARD_SCOPES = [
  "WEEKLY",
  "MONTHLY",
  "SEMESTER",
  "ALL_TIME",
] as const;

export type LeaderboardScope = typeof LEADERBOARD_SCOPES[number];

// Public product contract: Weekly Leaderboard was retired. Keep WEEKLY in
// LEADERBOARD_SCOPES for previously stored seasons and internal reconciliation.
// Weekly Challenges are a separate feature and remain enabled.
export const PUBLIC_LEADERBOARD_SCOPES = [
  "MONTHLY",
  "SEMESTER",
  "ALL_TIME",
] as const satisfies readonly LeaderboardScope[];

export function isPublicLeaderboardScope(
  scope: LeaderboardScope | null,
): scope is (typeof PUBLIC_LEADERBOARD_SCOPES)[number] {
  return scope !== null && (PUBLIC_LEADERBOARD_SCOPES as readonly string[]).includes(scope);
}
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
  level: number | null;
  score: number;
  displayName: string | null;
  avatarUrl: string | null;
  // Safe viewer-local marker so the frontend can immediately overlay the
  // authenticated user's fresh ledger score onto a still-rebuilding snapshot.
  isViewer: boolean;
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