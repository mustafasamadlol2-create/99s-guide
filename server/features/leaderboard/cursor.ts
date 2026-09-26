import { LeaderboardError } from "./errors.js";
import type { LeaderboardCursorPayload } from "./types.js";

const MAX_CURSOR_LENGTH = 2048;
const MAX_ID_LENGTH = 128;

export function encodeLeaderboardCursor(
  payload: LeaderboardCursorPayload,
): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeLeaderboardCursor(
  cursor: unknown,
  now = Date.now(),
): LeaderboardCursorPayload {
  if (
    typeof cursor !== "string"
    || cursor.length === 0
    || cursor.length > MAX_CURSOR_LENGTH
    || !/^[A-Za-z0-9_-]+$/u.test(cursor)
  ) {
    throw new LeaderboardError(
      "LEADERBOARD_CURSOR_INVALID",
      "Leaderboard cursor is invalid.",
    );
  }
  let value: unknown;
  try {
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.toString("base64url") !== cursor) {
      throw new Error("Non-canonical base64url.");
    }
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new LeaderboardError(
      "LEADERBOARD_CURSOR_INVALID",
      "Leaderboard cursor is invalid.",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LeaderboardError(
      "LEADERBOARD_CURSOR_INVALID",
      "Leaderboard cursor is invalid.",
    );
  }
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  const expected = [
    "expiresAt",
    "rank",
    "score",
    "seasonId",
    "snapshotId",
    "userId",
    "version",
  ];
  if (
    keys.length !== expected.length
    || keys.some((key, index) => key !== expected[index])
    || candidate.version !== 1
    || typeof candidate.snapshotId !== "string"
    || candidate.snapshotId.length < 1
    || candidate.snapshotId.length > MAX_ID_LENGTH
    || typeof candidate.seasonId !== "string"
    || candidate.seasonId.length < 1
    || candidate.seasonId.length > MAX_ID_LENGTH
    || typeof candidate.userId !== "string"
    || candidate.userId.length < 1
    || candidate.userId.length > MAX_ID_LENGTH
    || !Number.isSafeInteger(candidate.rank)
    || Number(candidate.rank) < 1
    || typeof candidate.score !== "string"
    || !/^-?\d+$/u.test(candidate.score)
    || !(
      candidate.expiresAt === null
      || (
        Number.isSafeInteger(candidate.expiresAt)
        && Number(candidate.expiresAt) > 0
      )
    )
  ) {
    throw new LeaderboardError(
      "LEADERBOARD_CURSOR_INVALID",
      "Leaderboard cursor is invalid.",
    );
  }
  const parsedScore = BigInt(candidate.score as string);
  if (
    parsedScore > BigInt(Number.MAX_SAFE_INTEGER)
    || parsedScore < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new LeaderboardError(
      "LEADERBOARD_CURSOR_INVALID",
      "Leaderboard cursor score is out of range.",
    );
  }
  if (candidate.expiresAt !== null && Number(candidate.expiresAt) <= now) {
    throw new LeaderboardError(
      "LEADERBOARD_CURSOR_EXPIRED",
      "Leaderboard cursor has expired. Request a new first page.",
    );
  }
  return candidate as LeaderboardCursorPayload;
}