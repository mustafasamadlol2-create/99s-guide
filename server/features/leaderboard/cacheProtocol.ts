import { createHash, createHmac, randomBytes } from "node:crypto";
import type { LeaderboardSeason, LeaderboardSnapshot, LeaderboardSnapshotEntry } from "@prisma/client";
import { OutboxDeliveryError } from "../../services/outboxDeliveryPolicy.js";
import type { LeaderboardScope } from "./types.js";

export const LEADERBOARD_CACHE_SCHEMA_VERSION = 1;
export const LEADERBOARD_CACHE_CHUNK_SIZE = 100;
export const LEADERBOARD_CACHE_MAX_ENTRIES = 20_000;
export const LEADERBOARD_CACHE_MAX_BODY_BYTES = 512 * 1024;
export const LEADERBOARD_CACHE_TIMEOUT_MS = 5_000;
export const LEADERBOARD_CACHE_RANKING_VERSION = "leaderboard-ranking-v1";

export type LeaderboardCacheEntry = {
  userId: string;
  rank: number;
  tieSize: number;
  score: number;
  levelSnapshot: number | null;
};

export type LeaderboardCacheManifest = {
  snapshotId: string;
  seasonId: string;
  scope: LeaderboardScope;
  seasonKey: string;
  snapshotType: "LIVE" | "FINAL";
  revision: number;
  seasonStatus: string;
  startsAt: string | null;
  endsAt: string | null;
  generatedAt: string;
  scoreThrough: string;
  entryCount: number;
  sourceFingerprint: string;
  projectionChecksum: string;
  chunkCount: number;
  rankingVersion: typeof LEADERBOARD_CACHE_RANKING_VERSION;
  cacheSchemaVersion: typeof LEADERBOARD_CACHE_SCHEMA_VERSION;
};

export function orderedCacheEntries(entries: readonly LeaderboardCacheEntry[]): LeaderboardCacheEntry[] {
  return [...entries].sort((a, b) =>
    a.rank - b.rank || b.score - a.score || a.userId.localeCompare(b.userId));
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function projectionChecksum(
  manifest: Pick<LeaderboardCacheManifest, "snapshotId" | "revision" | "entryCount" | "rankingVersion">,
  entries: readonly LeaderboardCacheEntry[],
): string {
  const ordered = orderedCacheEntries(entries);
  return sha256Hex(JSON.stringify([
    manifest.snapshotId,
    manifest.revision,
    manifest.entryCount,
    manifest.rankingVersion,
    ...ordered.map((entry) => [
      entry.userId, entry.rank, entry.tieSize, entry.score, entry.levelSnapshot,
    ]),
  ]));
}

export function chunkHash(
  snapshotId: string,
  chunkIndex: number,
  entries: readonly LeaderboardCacheEntry[],
): string {
  return sha256Hex(JSON.stringify([snapshotId, chunkIndex, entries]));
}

function safeInteger(value: number, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Invalid ${name}.`);
  }
}

export function buildLeaderboardCacheManifest(
  season: Pick<LeaderboardSeason, "id" | "scope" | "seasonKey" | "status" | "startsAt" | "endsAt">,
  snapshot: Pick<
    LeaderboardSnapshot,
    | "id"
    | "snapshotType"
    | "revision"
    | "generatedAt"
    | "scoreThrough"
    | "sourceFingerprint"
    | "entryCount"
    | "rankingSemanticsVersion"
  >,
  entries: readonly Pick<
    LeaderboardSnapshotEntry,
    "userId" | "rank" | "tieSize" | "score" | "levelSnapshot"
  >[],
): LeaderboardCacheManifest {
  if (snapshot.rankingSemanticsVersion !== LEADERBOARD_CACHE_RANKING_VERSION) {
    throw new Error("Unsupported canonical leaderboard ranking version.");
  }
  if (entries.length !== snapshot.entryCount) {
    throw new Error("Canonical leaderboard snapshot entry count is inconsistent.");
  }
  if (snapshot.snapshotType !== "LIVE" && snapshot.snapshotType !== "FINAL") {
    throw new Error("Unsupported canonical leaderboard snapshot type.");
  }
  const scope = season.scope as LeaderboardScope;
  const cacheEntries = entries.map(toCacheEntry);
  safeInteger(snapshot.revision, "revision", 1);
  safeInteger(snapshot.entryCount, "entryCount");
  const chunkCount = snapshot.entryCount === 0
    ? 0
    : Math.ceil(snapshot.entryCount / LEADERBOARD_CACHE_CHUNK_SIZE);
  return {
    snapshotId: snapshot.id,
    seasonId: season.id,
    scope,
    seasonKey: season.seasonKey,
    snapshotType: snapshot.snapshotType as "LIVE" | "FINAL",
    revision: snapshot.revision,
    seasonStatus: snapshot.snapshotType === "FINAL" ? "CLOSED" : season.status,
    startsAt: season.startsAt?.toISOString() ?? null,
    endsAt: season.endsAt?.toISOString() ?? null,
    generatedAt: snapshot.generatedAt.toISOString(),
    scoreThrough: snapshot.scoreThrough.toISOString(),
    entryCount: snapshot.entryCount,
    sourceFingerprint: snapshot.sourceFingerprint,
    projectionChecksum: projectionChecksum({
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      entryCount: snapshot.entryCount,
      rankingVersion: LEADERBOARD_CACHE_RANKING_VERSION,
    }, cacheEntries),
    chunkCount,
    rankingVersion: LEADERBOARD_CACHE_RANKING_VERSION,
    cacheSchemaVersion: LEADERBOARD_CACHE_SCHEMA_VERSION,
  };
}

export function toCacheEntry(entry: Pick<LeaderboardSnapshotEntry, "userId" | "rank" | "tieSize" | "score" | "levelSnapshot">): LeaderboardCacheEntry {
  if (!entry.userId) throw new Error("Leaderboard cache entry is missing user ID.");
  const score = Number(entry.score);
  safeInteger(entry.rank, "rank", 1);
  safeInteger(entry.tieSize, "tieSize", 1);
  safeInteger(score, "score", 1, Number.MAX_SAFE_INTEGER);
  return {
    userId: entry.userId,
    rank: entry.rank,
    tieSize: entry.tieSize,
    score,
    levelSnapshot: entry.levelSnapshot,
  };
}

export function getLeaderboardD1Config(environment: NodeJS.ProcessEnv = process.env): {
  baseUrl: string;
  secret: string;
} | null {
  const rawUrl = (environment.LEADERBOARD_D1_WORKER_URL || environment.PRIVATE_DATA_WORKER_BASE_URL || "").trim().replace(/\/+$/, "");
  const secret = (environment.LEADERBOARD_D1_SYNC_SECRET || "").trim();
  if (!rawUrl || !secret) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
  return { baseUrl: url.toString().replace(/\/+$/, ""), secret };
}

function hmacSignature(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export async function requestLeaderboardD1<T = unknown>(
  path: string,
  body?: Record<string, unknown>,
  options: { method?: "GET" | "POST"; timeoutMs?: number } = {},
): Promise<T> {
  const config = getLeaderboardD1Config();
  if (!config) {
    throw new OutboxDeliveryError("Leaderboard D1 Worker configuration is missing or invalid.", {
      failureClass: "AUTH_CONFIGURATION",
      failureCode: "CONFIG_MISSING_OR_INVALID",
    });
  }
  const url = new URL(path, `${config.baseUrl}/`);
  const method = options.method ?? "POST";
  if (method === "GET" && body !== undefined) {
    throw new OutboxDeliveryError("GET Leaderboard D1 requests cannot include a body.", {
      failureClass: "PERMANENT",
      failureCode: "INVALID_REQUEST",
    });
  }
  let raw: string;
  try {
    raw = method === "GET" ? "" : JSON.stringify(body ?? {});
  } catch {
    throw new OutboxDeliveryError("Leaderboard D1 payload is not serializable.", {
      failureClass: "PERMANENT",
      failureCode: "INVALID_PAYLOAD",
    });
  }
  if (Buffer.byteLength(raw, "utf8") > LEADERBOARD_CACHE_MAX_BODY_BYTES) {
    throw new OutboxDeliveryError("Leaderboard D1 projection payload exceeds the maximum body size.", {
      failureClass: "PERMANENT",
      failureCode: "PAYLOAD_TOO_LARGE",
    });
  }
  const timestamp = String(Date.now());
  const nonce = randomBytes(24).toString("base64url");
  const canonical = `${timestamp}.${nonce}.${method}.${url.pathname}.${url.search}.${sha256Hex(raw)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? LEADERBOARD_CACHE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        "X-Leaderboard-Timestamp": timestamp,
        "X-Leaderboard-Nonce": nonce,
        "X-Leaderboard-Signature": hmacSignature(config.secret, canonical),
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: raw } : {}),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      let responseCode: string | undefined;
      try {
        const parsed = JSON.parse(text) as { code?: unknown };
        if (typeof parsed.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(parsed.code)) {
          responseCode = parsed.code;
        }
      } catch {
        // Classify from the HTTP status if the Worker did not return JSON.
      }
      const safeCode = responseCode ?? `LEADERBOARD_D1_HTTP_${response.status}`;
      if (
        response.status === 401 ||
        response.status === 403 ||
        responseCode === "LEADERBOARD_CACHE_AUTH_UNAVAILABLE" ||
        responseCode === "LEADERBOARD_CACHE_UNAUTHORIZED" ||
        responseCode === "LEADERBOARD_CACHE_AUTH_EXPIRED" ||
        responseCode === "LEADERBOARD_CACHE_REPLAY"
      ) {
        throw new OutboxDeliveryError(
          `Leaderboard D1 Worker authentication/configuration is blocked (${safeCode}).`,
          { failureClass: "AUTH_CONFIGURATION", failureCode: safeCode },
        );
      }
      if (responseCode === "LEADERBOARD_CACHE_SCHEMA_INCOMPATIBLE") {
        throw new OutboxDeliveryError("Leaderboard D1 schema is incompatible with this projection.", {
          failureClass: "PERMANENT",
          failureCode: responseCode,
        });
      }
      if (response.status === 404 || response.status === 405) {
        throw new OutboxDeliveryError("Leaderboard D1 Worker endpoint is unavailable.", {
          failureClass: "AUTH_CONFIGURATION",
          failureCode: "WORKER_ENDPOINT_UNAVAILABLE",
        });
      }
      if (
        response.status === 408 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status >= 500
      ) {
        throw new OutboxDeliveryError(`Leaderboard D1 Worker returned a retryable response (${safeCode}).`, {
          failureClass: "TRANSIENT",
          failureCode: safeCode,
        });
      }
      throw new OutboxDeliveryError(`Leaderboard D1 Worker rejected the projection (${safeCode}).`, {
        failureClass: "PERMANENT",
        failureCode: safeCode,
      });
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new OutboxDeliveryError("Leaderboard D1 Worker returned an invalid response.", {
        failureClass: "OPERATIONAL",
        failureCode: "INVALID_WORKER_RESPONSE",
      });
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Clears only the derived D1 rows for one canonical snapshot. The Worker owns
 * the reset implementation; this helper only signs and sends the request.
 */
export async function resetLeaderboardD1Snapshot(
  snapshotId: string,
  timeoutMs = LEADERBOARD_CACHE_TIMEOUT_MS,
): Promise<void> {
  if (
    typeof snapshotId !== "string"
    || snapshotId.length < 1
    || snapshotId.length > 128
  ) {
    throw new Error("Leaderboard snapshot ID is invalid.");
  }
  await requestLeaderboardD1(
    "/internal/leaderboard-cache/reset",
    { snapshotId },
    { method: "POST", timeoutMs },
  );
}
