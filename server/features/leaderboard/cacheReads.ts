import { recordOperationalOutcome } from "../../observability/metrics.js";

import type { LeaderboardSeason, LeaderboardSnapshot, PrismaClient } from "@prisma/client";
import { logger } from "../../services/logger.js";
import { getPrisma } from "../../services/prismaClient.js";
import { isStudyFeatureEnabled } from "../study-core/featureFlags.js";
import { encodeLeaderboardCursor } from "./cursor.js";
import { LeaderboardError } from "./errors.js";
import {
  LEADERBOARD_CACHE_RANKING_VERSION,
  LEADERBOARD_CACHE_SCHEMA_VERSION,
  requestLeaderboardD1,
} from "./cacheProtocol.js";
import {
  buildBaseEntryWhere,
  getBlockedUserIds,
  getLeaderboardPage,
  getMyLeaderboardRank,
  parseLeaderboardPageSize,
  resolveSeason,
  seasonDto,
  validateCursorSnapshot,
} from "./queries.js";
import {
  getLatestLeaderboardSnapshot,
  LEADERBOARD_LIVE_CURSOR_RETENTION_MS,
  LEADERBOARD_LIVE_FRESHNESS_MS,
  LEADERBOARD_LIVE_HARD_STALE_MS,
} from "./snapshots.js";
import type {
  LeaderboardCursorPayload,
  LeaderboardScope,
  PublicLeaderboardEntry,
} from "./types.js";

const CACHE_CURRENT_PATH = "/internal/leaderboard-cache/current";
const CACHE_PAGE_PATH = "/internal/leaderboard-cache/page";
const CACHE_RANK_PATH = "/internal/leaderboard-cache/rank";

type CacheManifest = {
  snapshotId: string;
  seasonId: string;
  scope: string;
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
  state: string;
  rankingVersion: string;
  cacheSchemaVersion: number;
};

type CacheEntry = {
  userId: string;
  rank: number;
  tieSize: number;
  score: number;
  levelSnapshot: number | null;
};

type CachePage = {
  ok: true;
  manifest: unknown;
  entries: unknown;
  nextCursor: unknown;
};

type CacheRank = {
  ok: true;
  manifest: unknown;
  entry: unknown;
};

class CacheRejected extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeInteger(value: unknown, min = 0): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= min;
}

function canonicalIso(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function parseManifest(value: unknown): CacheManifest {
  if (!isRecord(value)) throw new CacheRejected("Cache manifest is missing.");
  const requiredStrings = [
    "snapshotId", "seasonId", "scope", "seasonKey", "seasonStatus",
    "projectionChecksum", "rankingVersion", "state", "sourceFingerprint",
  ] as const;
  if (requiredStrings.some((key) =>
    typeof value[key] !== "string" || value[key].length === 0)) {
    throw new CacheRejected("Cache manifest has invalid text fields.");
  }
  if (
    (value.snapshotType !== "LIVE" && value.snapshotType !== "FINAL")
    || !safeInteger(value.revision, 1)
    || !safeInteger(value.entryCount)
    || !safeInteger(value.chunkCount)
    || !safeInteger(value.cacheSchemaVersion, 1)
    || !canonicalIso(value.generatedAt)
    || !canonicalIso(value.scoreThrough)
    || !/^[a-f0-9]{64}$/u.test(value.projectionChecksum as string)
    || !/^[a-f0-9]{64}$/u.test(value.sourceFingerprint as string)
    || !(
      value.startsAt === null
      || value.startsAt === undefined
      || canonicalIso(value.startsAt)
    )
    || !(
      value.endsAt === null
      || value.endsAt === undefined
      || canonicalIso(value.endsAt)
    )
  ) {
    throw new CacheRejected("Cache manifest contains invalid metadata.");
  }
  return value as unknown as CacheManifest;
}

function validateManifestForSnapshot(
  manifest: CacheManifest,
  season: LeaderboardSeason,
  snapshot: LeaderboardSnapshot,
): void {
  if (
    manifest.state !== "READY"
    || manifest.cacheSchemaVersion !== LEADERBOARD_CACHE_SCHEMA_VERSION
    || manifest.rankingVersion !== LEADERBOARD_CACHE_RANKING_VERSION
    || manifest.snapshotId !== snapshot.id
    || manifest.seasonId !== season.id
    || manifest.scope !== season.scope
    || manifest.seasonKey !== season.seasonKey
    || manifest.snapshotType !== snapshot.snapshotType
    || manifest.seasonStatus !== (
      snapshot.snapshotType === "FINAL" ? "CLOSED" : season.status
    )
    || manifest.startsAt !== (season.startsAt?.toISOString() ?? null)
    || manifest.endsAt !== (season.endsAt?.toISOString() ?? null)
    || manifest.revision !== snapshot.revision
    || manifest.rankingVersion !== snapshot.rankingSemanticsVersion
    || manifest.generatedAt !== snapshot.generatedAt.toISOString()
    || manifest.scoreThrough !== snapshot.scoreThrough.toISOString()
    || manifest.entryCount !== snapshot.entryCount
    || manifest.sourceFingerprint !== snapshot.sourceFingerprint
    || (snapshot.snapshotType === "FINAL" && manifest.seasonStatus !== "CLOSED")
  ) {
    throw new CacheRejected("Cache metadata does not match the canonical snapshot.");
  }
}

function validateFreshness(
  manifest: CacheManifest,
  now: Date,
): boolean {
  if (manifest.snapshotType === "FINAL") return false;
  const age = now.getTime() - Date.parse(manifest.generatedAt);
  if (age < 0 || age > LEADERBOARD_LIVE_HARD_STALE_MS) {
    throw new CacheRejected("Live cache is outside its hard freshness window.");
  }
  return age > LEADERBOARD_LIVE_FRESHNESS_MS;
}

function validateSnapshotFreshness(
  snapshot: LeaderboardSnapshot,
  now: Date,
): boolean {
  if (snapshot.snapshotType === "FINAL") return false;
  const age = now.getTime() - snapshot.generatedAt.getTime();
  if (age < 0 || age > LEADERBOARD_LIVE_HARD_STALE_MS) {
    throw new CacheRejected("Live cache is outside its hard freshness window.");
  }
  return age > LEADERBOARD_LIVE_FRESHNESS_MS;
}

async function getCurrentManifest(
  season: LeaderboardSeason,
): Promise<CacheManifest> {
  const params = new URLSearchParams({
    scope: season.scope,
    seasonKey: season.seasonKey,
  });
  const result = await requestLeaderboardD1<{ ok?: unknown; manifest?: unknown }>(
    `${CACHE_CURRENT_PATH}?${params.toString()}`,
    undefined,
    { method: "GET" },
  );
  if (!isRecord(result) || result.ok !== true) {
    throw new CacheRejected("Cache current-pointer response is invalid.");
  }
  return parseManifest(result.manifest);
}

async function getPage(
  snapshot: LeaderboardSnapshot,
  limit: number,
  cursor?: LeaderboardCursorPayload,
): Promise<{ manifest: CacheManifest; entries: CacheEntry[]; nextCursor: {
  afterRank: number; afterScore: number; afterUserId: string;
} | null }> {
  const params = new URLSearchParams({
    snapshotId: snapshot.id,
    limit: String(limit),
  });
  if (cursor) {
    params.set("afterRank", String(cursor.rank));
    params.set("afterScore", cursor.score);
    params.set("afterUserId", cursor.userId);
  }
  const result = await requestLeaderboardD1<CachePage>(
    `${CACHE_PAGE_PATH}?${params.toString()}`,
    undefined,
    { method: "GET" },
  );
  if (!isRecord(result) || result.ok !== true || !Array.isArray(result.entries)) {
    throw new CacheRejected("Cache page response is invalid.");
  }
  const manifest = parseManifest(result.manifest);
  const entries = result.entries.map(parseEntry);
  if (entries.length > limit) throw new CacheRejected("Cache page exceeds its requested size.");
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (
      current.rank < previous.rank
      || (current.rank === previous.rank && current.score > previous.score)
      || (
        current.rank === previous.rank
        && current.score === previous.score
        && current.userId.localeCompare(previous.userId) <= 0
      )
    ) {
      throw new CacheRejected("Cache page order is invalid.");
    }
  }
  let nextCursor: {
    afterRank: number; afterScore: number; afterUserId: string;
  } | null = null;
  if (result.nextCursor !== null) {
    if (!isRecord(result.nextCursor)) throw new CacheRejected("Cache cursor is invalid.");
    const { afterRank, afterScore, afterUserId } = result.nextCursor;
    if (
      !safeInteger(afterRank, 1)
      || !safeInteger(afterScore, Number.MIN_SAFE_INTEGER)
      || typeof afterUserId !== "string"
      || afterUserId.length === 0
      || entries.length !== limit
    ) {
      throw new CacheRejected("Cache cursor boundary is invalid.");
    }
    nextCursor = { afterRank, afterScore, afterUserId };
  }
  return { manifest, entries, nextCursor };
}

function parseEntry(value: unknown): CacheEntry {
  if (!isRecord(value)) throw new CacheRejected("Cache entry is invalid.");
  const userId = value.userId ?? value.user_id;
  const tieSize = value.tieSize ?? value.tie_size;
  const levelSnapshot = value.levelSnapshot ?? value.level_snapshot ?? null;
  let parsedLevelSnapshot: number | null = null;
  if (levelSnapshot !== null) {
    if (!safeInteger(levelSnapshot)) {
      throw new CacheRejected("Cache entry level snapshot is invalid.");
    }
    parsedLevelSnapshot = levelSnapshot;
  }
  if (
    typeof userId !== "string"
    || userId.length === 0
    || !safeInteger(value.rank, 1)
    || !safeInteger(tieSize, 1)
    || !safeInteger(value.score, Number.MIN_SAFE_INTEGER)
    || Number(value.score) <= 0
  ) {
    throw new CacheRejected("Cache entry contains invalid rank data.");
  }
  return {
    userId,
    rank: value.rank,
    tieSize,
    score: value.score,
    levelSnapshot: parsedLevelSnapshot,
  };
}

function compareManifests(a: CacheManifest, b: CacheManifest): boolean {
  return a.snapshotId === b.snapshotId
    && a.revision === b.revision
    && a.projectionChecksum === b.projectionChecksum
    && a.entryCount === b.entryCount
    && a.sourceFingerprint === b.sourceFingerprint
    && a.cacheSchemaVersion === b.cacheSchemaVersion
    && a.rankingVersion === b.rankingVersion;
}

async function getVisibleUserIds(input: {
  userIds: string[];
  database: PrismaClient;
  blockedUserIds: string[];
}): Promise<Set<string>> {
  if (input.userIds.length === 0) return new Set();
  const users = await input.database.user.findMany({
    where: {
      id: {
        in: input.userIds,
        ...(input.blockedUserIds.length > 0
          ? { notIn: input.blockedUserIds }
          : {}),
      },
      accountStatus: "ACTIVE",
    },
    select: { id: true },
  });
  return new Set(users.map((user) => user.id));
}

function cacheIsEnabled(): boolean {
  return isStudyFeatureEnabled("LEADERBOARD_D1_READ_ENABLED");
}

function warnFallback(): void {
  recordOperationalOutcome({
    feature: "leaderboard_d1",
    operation: "fallback",
    result: "fallback",
  });
  logger.warn(
    "[LeaderboardD1]",
    "Cache read unavailable or inconsistent; serving canonical PostgreSQL data.",
  );
}

export async function getLeaderboardPageWithCache(input: {
  viewerId: string;
  scope: LeaderboardScope;
  seasonKey?: string;
  limit?: unknown;
  cursor?: LeaderboardCursorPayload;
  now?: Date;
  database?: PrismaClient;
}): Promise<{
  scope: LeaderboardScope;
  season: ReturnType<typeof seasonDto>;
  generatedAt: string;
  scoreThrough: string;
  isStale: boolean;
  totalRankedUsers: number;
  entries: PublicLeaderboardEntry[];
  nextCursor: string | null;
}> {
  if (!cacheIsEnabled()) return getLeaderboardPage(input);
  const database = input.database ?? getPrisma() as PrismaClient;
  const now = input.now ? new Date(input.now) : new Date();
  const limit = parseLeaderboardPageSize(input.limit);
  try {
    const season = await resolveSeason({
      scope: input.scope,
      ...(input.seasonKey ? { seasonKey: input.seasonKey } : {}),
      now,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      database,
    });
    const snapshot = input.cursor
      ? await validateCursorSnapshot({
        cursor: input.cursor,
        season,
        database,
        now,
      })
      : await getLatestLeaderboardSnapshot(
        season.id,
        season.status === "CLOSED" ? "FINAL" : "LIVE",
        database,
      );
    if (!snapshot || snapshot.status !== "READY") throw new CacheRejected("Canonical snapshot is not cached.");
    const manifest = input.cursor
      ? null
      : await getCurrentManifest(season);
    if (manifest) validateManifestForSnapshot(manifest, season, snapshot);
    if (!input.cursor && manifest?.snapshotId !== snapshot.id) {
      throw new CacheRejected("D1 current pointer is behind PostgreSQL.");
    }
    const isStale = manifest
      ? validateFreshness(manifest, now)
      : validateSnapshotFreshness(snapshot, now);
    const page = await getPage(snapshot, limit, input.cursor);
    validateManifestForSnapshot(page.manifest, season, snapshot);
    if (manifest && !compareManifests(manifest, page.manifest)) {
      throw new CacheRejected("Current pointer and page projection metadata differ.");
    }
    if (
      !input.cursor
      && snapshot.entryCount > page.entries.length
      && page.nextCursor === null
    ) {
      throw new CacheRejected("Cache page is incomplete.");
    }
    if (page.nextCursor) {
      const boundary = await database.leaderboardSnapshotEntry.findFirst({
        where: {
          snapshotId: snapshot.id,
          userId: page.nextCursor.afterUserId,
        },
        select: { rank: true, score: true },
      });
      if (
        !boundary
        || boundary.rank !== page.nextCursor.afterRank
        || boundary.score.toString() !== String(page.nextCursor.afterScore)
      ) {
        throw new CacheRejected("Cache cursor boundary is not canonical.");
      }
    }
    const blockedUserIds = await getBlockedUserIds(input.viewerId, database);
    const [visibleUserIds, totalRankedUsers] = await Promise.all([
      getVisibleUserIds({
        userIds: [...new Set(page.entries.map((entry) => entry.userId))],
        database,
        blockedUserIds,
      }),
      database.leaderboardSnapshotEntry.count({
        where: buildBaseEntryWhere(snapshot.id, blockedUserIds),
      }),
    ]);
    const entries: PublicLeaderboardEntry[] = page.entries.flatMap((entry) =>
      visibleUserIds.has(entry.userId)
        ? [{
          rank: entry.rank,
          tieSize: entry.tieSize,
          userId: entry.userId,
          level: entry.levelSnapshot,
          score: entry.score,
        }]
        : []);
    const expiresAt = snapshot.snapshotType === "LIVE"
      ? snapshot.generatedAt.getTime() + LEADERBOARD_LIVE_CURSOR_RETENTION_MS
      : null;
    const nextCursor = page.nextCursor
      && (expiresAt === null || expiresAt > now.getTime())
      ? encodeLeaderboardCursor({
        version: 1,
        snapshotId: snapshot.id,
        seasonId: season.id,
        rank: page.nextCursor.afterRank,
        score: String(page.nextCursor.afterScore),
        userId: page.nextCursor.afterUserId,
        expiresAt,
      })
      : null;
    return {
      scope: input.scope,
      season: seasonDto(season),
      generatedAt: snapshot.generatedAt.toISOString(),
      scoreThrough: snapshot.scoreThrough.toISOString(),
      isStale,
      totalRankedUsers,
      entries,
      nextCursor,
    };
  } catch (error) {
    if (error instanceof LeaderboardError) throw error;
    warnFallback();
    return getLeaderboardPage({ ...input, database });
  }
}

export async function getMyLeaderboardRankWithCache(input: {
  viewerId: string;
  scope: LeaderboardScope;
  seasonKey?: string;
  now?: Date;
  database?: PrismaClient;
}): Promise<{
  scope: LeaderboardScope;
  season: ReturnType<typeof seasonDto>;
  rank: number | null;
  score: number;
  tieSize: number | null;
  totalRankedUsers: number;
  notRanked: boolean;
  snapshotGeneratedAt: string;
}> {
  if (!cacheIsEnabled()) return getMyLeaderboardRank(input);
  const database = input.database ?? getPrisma() as PrismaClient;
  const now = input.now ? new Date(input.now) : new Date();
  try {
    const season = await resolveSeason({
      scope: input.scope,
      ...(input.seasonKey ? { seasonKey: input.seasonKey } : {}),
      now,
      database,
    });
    const snapshot = await getLatestLeaderboardSnapshot(
      season.id,
      season.status === "CLOSED" ? "FINAL" : "LIVE",
      database,
    );
    if (!snapshot || snapshot.status !== "READY") throw new CacheRejected("Canonical snapshot is not cached.");
    const manifest = await getCurrentManifest(season);
    validateManifestForSnapshot(manifest, season, snapshot);
    if (manifest.snapshotId !== snapshot.id) {
      throw new CacheRejected("D1 current pointer is behind PostgreSQL.");
    }
    validateFreshness(manifest, now);
    const params = new URLSearchParams({
      snapshotId: snapshot.id,
      userId: input.viewerId,
    });
    const result = await requestLeaderboardD1<CacheRank>(
      `${CACHE_RANK_PATH}?${params.toString()}`,
      undefined,
      { method: "GET" },
    );
    if (!isRecord(result) || result.ok !== true) {
      throw new CacheRejected("Cache rank response is invalid.");
    }
    const pageManifest = parseManifest(result.manifest);
    validateManifestForSnapshot(pageManifest, season, snapshot);
    if (!compareManifests(manifest, pageManifest)) {
      throw new CacheRejected("Current pointer and rank metadata differ.");
    }
    if (result.entry === null || result.entry === undefined) {
      return getMyLeaderboardRank({ ...input, database });
    }
    const entry = parseEntry(result.entry);
    if (entry.userId !== input.viewerId) throw new CacheRejected("Cache rank user is invalid.");
    const [canonical, blockedUserIds] = await Promise.all([
      database.leaderboardSnapshotEntry.findFirst({
        where: { snapshotId: snapshot.id, userId: input.viewerId },
        select: { rank: true, tieSize: true, score: true },
      }),
      getBlockedUserIds(input.viewerId, database),
    ]);
    if (
      !canonical
      || canonical.rank !== entry.rank
      || canonical.tieSize !== entry.tieSize
      || canonical.score.toString() !== String(entry.score)
    ) {
      throw new CacheRejected("Cached own-rank row differs from PostgreSQL.");
    }
    const totalRankedUsers = await database.leaderboardSnapshotEntry.count({
      where: buildBaseEntryWhere(snapshot.id, blockedUserIds),
    });
    return {
      scope: input.scope,
      season: seasonDto(season),
      rank: entry.rank,
      score: entry.score,
      tieSize: entry.tieSize,
      totalRankedUsers,
      notRanked: false,
      snapshotGeneratedAt: snapshot.generatedAt.toISOString(),
    };
  } catch (error) {
    if (error instanceof LeaderboardError) throw error;
    warnFallback();
    return getMyLeaderboardRank({ ...input, database });
  }
}