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
  safePublicAvatarUrl,
  safePublicDisplayName,
  seasonDto,
  validateCursorSnapshot,
} from "./queries.js";
import {
  getLatestLeaderboardSnapshot,
  getReadableLeaderboardSnapshot,
  isLeaderboardSnapshotScoringCurrent,
  LEADERBOARD_LIVE_FRESHNESS_MS,
  LEADERBOARD_LIVE_CURSOR_RETENTION_MS,
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

const liveSnapshotRebuilds = new Map<string, Promise<void>>();

// Share reconciliation across overlapping page/rank reads, but never force a
// new revision on every visit. The canonical read helper checks snapshot age,
// the active user roster, scoring semantics, and new Points V2 ledger entries.
async function ensureCurrentLiveSnapshot(input: {
  season: LeaderboardSeason;
  now: Date;
  database: PrismaClient;
}): Promise<void> {
  const seasonId = input.season.id;
  const existing = liveSnapshotRebuilds.get(seasonId);
  if (existing) return existing;
  const task = getReadableLeaderboardSnapshot({
    season: input.season,
    now: input.now,
    database: input.database,
  }).then(() => undefined);
  liveSnapshotRebuilds.set(seasonId, task);
  try {
    await task;
  } finally {
    if (liveSnapshotRebuilds.get(seasonId) === task) {
      liveSnapshotRebuilds.delete(seasonId);
    }
  }
}

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
    || !isLeaderboardSnapshotScoringCurrent(
      snapshot,
      season.scope as LeaderboardScope,
    )
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
    || Number(value.score) < 0
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

// The Worker returns snake_case rank rows from SQLite. Never trust an
// unrelated or malformed row for the authenticated account.
export function parseOwnLeaderboardD1Entry(value: unknown, viewerId: string): CacheEntry | null {
  if (value === null) return null;
  const parsed = parseEntry(value);
  if (parsed.userId !== viewerId) {
    throw new CacheRejected("D1 rank entry does not belong to the authenticated viewer.");
  }
  return parsed;
}

async function getOwnRankFromD1(snapshot: LeaderboardSnapshot, viewerId: string): Promise<{
  manifest: CacheManifest;
  entry: CacheEntry | null;
}> {
  const params = new URLSearchParams({ snapshotId: snapshot.id, userId: viewerId });
  const result = await requestLeaderboardD1<CacheRank>(
    `${CACHE_RANK_PATH}?${params.toString()}`,
    undefined,
    { method: "GET" },
  );
  if (!isRecord(result) || result.ok !== true || !("entry" in result)) {
    throw new CacheRejected("D1 own-rank response is invalid.");
  }
  return {
    manifest: parseManifest(result.manifest),
    entry: parseOwnLeaderboardD1Entry(result.entry, viewerId),
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

async function getVisibleUsers(input: {
  userIds: string[];
  database: PrismaClient;
  blockedUserIds: string[];
}): Promise<Map<string, { displayName: string | null; avatarUrl: string | null }>> {
  if (input.userIds.length === 0) return new Map();
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
    select: { id: true, name: true, avatar: true, avatarUrl: true },
  });
  return new Map(users.map((user) => [
    user.id,
    {
      displayName: safePublicDisplayName(user.name),
      avatarUrl: safePublicAvatarUrl(user.avatarUrl || user.avatar),
    },
  ]));
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
  // A first-page read checks the latest canonical ledger and roster before
  // displaying cached ranking data. It never forces a revision for an unchanged
  // source; cursor pages remain pinned to their original snapshot.
  if (!input.cursor) {
    const database = input.database ?? getPrisma() as PrismaClient;
    const now = input.now ? new Date(input.now) : new Date();
    const season = await resolveSeason({
      scope: input.scope,
      ...(input.seasonKey ? { seasonKey: input.seasonKey } : {}),
      now,
      database,
    });
    if (season.status !== "CLOSED") {
      await ensureCurrentLiveSnapshot({ season, now, database });
    }
    // With reads disabled, preserve the canonical-first behavior. Once the
    // flag is enabled, the same fresh canonical snapshot is validated against
    // D1 below; any missing/lagging replica falls back to PostgreSQL.
    if (!cacheIsEnabled()) {
      return getLeaderboardPage({ ...input, now, database });
    }
  }
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
    if (
      snapshot
      && !input.cursor
      && !isLeaderboardSnapshotScoringCurrent(snapshot, input.scope)
    ) {
      throw new CacheRejected("PostgreSQL snapshot uses an obsolete scoring mode.");
    }
    if (!snapshot || snapshot.status !== "READY") throw new CacheRejected("Canonical snapshot is not cached.");
    // These reads are independent after resolving the canonical snapshot.
    // Run the PostgreSQL roster/source checks and both D1 reads together instead
    // of serially adding round trips to every leaderboard open. A LIVE D1
    // snapshot must never hide a newly committed Points V2 ledger entry merely
    // because its age is still inside the normal freshness window.
    const [manifest, page, activeUserCount, ledgerChangeAfterSnapshot] = await Promise.all([
      input.cursor ? Promise.resolve(null) : getCurrentManifest(season),
      getPage(snapshot, limit, input.cursor),
      season.status === "CLOSED"
        ? Promise.resolve(snapshot.entryCount)
        : database.user.count({
          where: {
            accountStatus: "ACTIVE",
            createdAt: { lte: now },
          },
        }),
      input.cursor || snapshot.snapshotType === "FINAL"
        ? Promise.resolve(null)
        : database.studyPointsLedgerEntry.findFirst({
          where: {
            createdAt: { gt: snapshot.generatedAt },
            sourceType: { not: "LEGACY_POINTS_LOG" },
            category: { not: "LEGACY" },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
        }),
    ]);
    if (!input.cursor && ledgerChangeAfterSnapshot) {
      throw new CacheRejected("Canonical Points V2 ledger is newer than the cached leaderboard snapshot.");
    }
    if (season.status !== "CLOSED" && snapshot.entryCount !== activeUserCount) {
      throw new CacheRejected("PostgreSQL snapshot does not include the active account roster.");
    }
    if (manifest) validateManifestForSnapshot(manifest, season, snapshot);
    if (!input.cursor && manifest?.snapshotId !== snapshot.id) {
      throw new CacheRejected("D1 current pointer is behind PostgreSQL.");
    }
    const isStale = manifest
      ? validateFreshness(manifest, now)
      : validateSnapshotFreshness(snapshot, now);
    validateManifestForSnapshot(page.manifest, season, snapshot);
    if (manifest && !compareManifests(manifest, page.manifest)) {
      throw new CacheRejected("Current pointer and page projection metadata differ.");
    }
    if (
      !input.cursor
      && snapshot.entryCount > 0
      && page.entries.length === 0
    ) {
      throw new CacheRejected("Cache first page is empty despite canonical snapshot entries.");
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
      getVisibleUsers({
        userIds: [...new Set(page.entries.map((entry) => entry.userId))],
        database,
        blockedUserIds,
      }),
      database.leaderboardSnapshotEntry.count({
        where: buildBaseEntryWhere(snapshot.id, blockedUserIds),
      }),
    ]);
    // D1 paginates before account visibility filtering. If a blocked or
    // inactive account appears in its page, canonical pagination must fill
    // the gap instead of silently returning an underfilled page.
    if (page.entries.some((entry) => !visibleUserIds.has(entry.userId))) {
      throw new CacheRejected("D1 page includes accounts filtered for this viewer.");
    }
    const entries: PublicLeaderboardEntry[] = page.entries.flatMap((entry) =>
      visibleUserIds.has(entry.userId)
        ? [{
          rank: entry.rank,
          tieSize: entry.tieSize,
          level: entry.levelSnapshot,
          score: entry.score,
          displayName: visibleUserIds.get(entry.userId)?.displayName ?? null,
          avatarUrl: visibleUserIds.get(entry.userId)?.avatarUrl ?? null,
          isViewer: entry.userId === input.viewerId,
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
  const database = input.database ?? getPrisma() as PrismaClient;
  const now = input.now ? new Date(input.now) : new Date();
  // Canonical freshness remains authoritative even with D1 reads enabled.
  // With projection lag, the read fails over to PostgreSQL rather than showing
  // a stale rank or score.
  const season = await resolveSeason({
    scope: input.scope,
    ...(input.seasonKey ? { seasonKey: input.seasonKey } : {}),
    now,
    database,
  });
  if (season.status !== "CLOSED") {
    await ensureCurrentLiveSnapshot({ season, now, database });
  }
  if (!cacheIsEnabled()) {
    return getMyLeaderboardRank({ ...input, now, database });
  }
  try {
    const snapshot = await getLatestLeaderboardSnapshot(
      season.id,
      season.status === "CLOSED" ? "FINAL" : "LIVE",
      database,
    );
    if (
      !snapshot
      || snapshot.status !== "READY"
      || !isLeaderboardSnapshotScoringCurrent(snapshot, input.scope)
    ) {
      throw new CacheRejected("Canonical rank snapshot is unavailable or obsolete.");
    }
    const [current, cached, activeCount, newerLedger] = await Promise.all([
      getCurrentManifest(season),
      getOwnRankFromD1(snapshot, input.viewerId),
      season.status === "CLOSED"
        ? Promise.resolve(snapshot.entryCount)
        : database.user.count({
          where: { accountStatus: "ACTIVE", createdAt: { lte: now } },
        }),
      snapshot.snapshotType === "FINAL"
        ? Promise.resolve(null)
        : database.studyPointsLedgerEntry.findFirst({
          where: {
            createdAt: { gt: snapshot.generatedAt },
            sourceType: { not: "LEGACY_POINTS_LOG" },
            category: { not: "LEGACY" },
          },
          select: { id: true },
        }),
    ]);
    validateManifestForSnapshot(current, season, snapshot);
    validateManifestForSnapshot(cached.manifest, season, snapshot);
    if (!compareManifests(current, cached.manifest)) {
      throw new CacheRejected("D1 own-rank and current-pointer revisions differ.");
    }
    validateFreshness(current, now);
    // Active users, including zero-point students, belong to the snapshot.
    // A missing D1 row is not a reliable "not ranked" answer; let the
    // canonical path distinguish a truly ineligible account.
    if (cached.entry === null) {
      throw new CacheRejected("Own-rank row is missing from D1; check canonical eligibility.");
    }
    if (newerLedger) {
      throw new CacheRejected("Points V2 ledger changed since the D1 rank snapshot.");
    }
    if (season.status !== "CLOSED" && activeCount !== snapshot.entryCount) {
      throw new CacheRejected("D1 rank snapshot is behind the active roster.");
    }
    const blockedUserIds = await getBlockedUserIds(input.viewerId, database);
    const totalRankedUsers = await database.leaderboardSnapshotEntry.count({
      where: buildBaseEntryWhere(snapshot.id, blockedUserIds),
    });
    return {
      scope: input.scope,
      season: seasonDto(season),
      rank: cached.entry.rank,
      score: cached.entry.score,
      tieSize: cached.entry.tieSize,
      totalRankedUsers,
      notRanked: false,
      snapshotGeneratedAt: snapshot.generatedAt.toISOString(),
    };
  } catch (error) {
    if (error instanceof LeaderboardError) throw error;
    warnFallback();
    return getMyLeaderboardRank({ ...input, now, database });
  }
}
