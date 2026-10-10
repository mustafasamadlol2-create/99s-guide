import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { LeaderboardError } from "./errors.js";
import type { LeaderboardCursorPayload } from "./types.js";

const MAX_CURSOR_LENGTH = 2048;
const MAX_ID_LENGTH = 128;
const CURSOR_VERSION_PREFIX = "v2_";
const CURSOR_NONCE_BYTES = 12;
const CURSOR_TAG_BYTES = 16;

function cursorEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new LeaderboardError(
      "LEADERBOARD_CURSOR_CONFIGURATION_MISSING",
      "Leaderboard pagination is temporarily unavailable.",
    );
  }
  return createHash("sha256")
    .update(`leaderboard-cursor-v2\u0000${secret}`, "utf8")
    .digest();
}

export function encodeLeaderboardCursor(
  payload: LeaderboardCursorPayload,
): string {
  const nonce = randomBytes(CURSOR_NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", cursorEncryptionKey(), nonce);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return CURSOR_VERSION_PREFIX + Buffer.concat([
    nonce,
    cipher.getAuthTag(),
    ciphertext,
  ]).toString("base64url");
}

export function decodeLeaderboardCursor(
  cursor: unknown,
  now = Date.now(),
): LeaderboardCursorPayload {
  if (
    typeof cursor !== "string"
    || cursor.length === 0
    || cursor.length > MAX_CURSOR_LENGTH
    || !/^[A-Za-z0-9_-]+$/u.test(
      cursor.startsWith(CURSOR_VERSION_PREFIX)
        ? cursor.slice(CURSOR_VERSION_PREFIX.length)
        : cursor,
    )
  ) {
    throw new LeaderboardError(
      "LEADERBOARD_CURSOR_INVALID",
      "Leaderboard cursor is invalid.",
    );
  }
  if (!cursor.startsWith(CURSOR_VERSION_PREFIX)) {
    throw new LeaderboardError(
      "LEADERBOARD_CURSOR_EXPIRED",
      "Leaderboard pagination changed. Request a new first page.",
    );
  }
  let value: unknown;
  try {
    const encoded = cursor.slice(CURSOR_VERSION_PREFIX.length);
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) {
      throw new Error("Non-canonical base64url.");
    }
    if (bytes.length <= CURSOR_NONCE_BYTES + CURSOR_TAG_BYTES) {
      throw new Error("Encrypted cursor is truncated.");
    }
    const nonce = bytes.subarray(0, CURSOR_NONCE_BYTES);
    const tag = bytes.subarray(CURSOR_NONCE_BYTES, CURSOR_NONCE_BYTES + CURSOR_TAG_BYTES);
    const ciphertext = bytes.subarray(CURSOR_NONCE_BYTES + CURSOR_TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", cursorEncryptionKey(), nonce);
    decipher.setAuthTag(tag);
    value = JSON.parse(Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8"));
  } catch (error) {
    if (
      error instanceof LeaderboardError
      && error.code === "LEADERBOARD_CURSOR_CONFIGURATION_MISSING"
    ) {
      throw error;
    }
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