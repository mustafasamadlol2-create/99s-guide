import {
  Prisma,
  type LeaderboardSeason,
  type LeaderboardSnapshot,
  type PrismaClient,
} from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { LeaderboardError } from "./errors.js";
import { encodeLeaderboardCursor } from "./cursor.js";
import { getLeaderboardSnapshotById, getReadableLeaderboardSnapshot, isLeaderboardSnapshotScoringCurrent, LEADERBOARD_LIVE_CURSOR_RETENTION_MS } from "./snapshots.js";
import { getLeaderboardSeasonById, getLeaderboardSeasonByKey, ensureLeaderboardSeason, leaderboardSeasonToWindow } from "./seasons.js";
import { decodeLeaderboardScore, readUserLeaderboardScore } from "./scores.js";
import {
  LEADERBOARD_SCOPES,
  type LeaderboardCursorPayload,
  type LeaderboardScope,
  type PublicLeaderboardEntry,
} from "./types.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const EMAIL_LIKE = /(?:^|\s)[^\s@]+@[^\s@]+(?:$|\s)/u;
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function safePublicDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized || EMAIL_LIKE.test(normalized) || UUID_LIKE.test(normalized)) {
    return null;
  }
  return normalized.slice(0, 80).trim() || null;
}

export function safePublicAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 2_048) return null;
  if (normalized.startsWith("/") && !normalized.startsWith("//")) {
    return normalized;
  }
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? normalized
      : null;
  } catch {
    return null;
  }
}

export type LeaderboardSeasonDto = {
  id: string;
  scope: LeaderboardScope;
  seasonKey: string;
  startsAt: string | null;
  endsAt: string | null;
  status: string;
};

export function seasonDto(season: LeaderboardSeason): LeaderboardSeasonDto {
  const scope = leaderboardSeasonToWindow(season).scope;
  return {
    id: season.id,
    scope,
    seasonKey: season.seasonKey,
    startsAt: season.startsAt?.toISOString() ?? null,
    endsAt: season.endsAt?.toISOString() ?? null,
    status: season.status,
  };
}

function parsePageSize(value: unknown): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d{1,3}$/u.test(value)
      ? Number(value)
      : NaN;
  if (
    !Number.isSafeInteger(parsed)
    || parsed < 1
    || parsed > MAX_PAGE_SIZE
  ) {
    throw new LeaderboardError(
      "LEADERBOARD_INVALID_INPUT",
      `Page size must be an integer between 1 and ${MAX_PAGE_SIZE}.`,
    );
  }
  return parsed;
}

export function parseLeaderboardPageSize(value: unknown): number {
  return parsePageSize(value);
}

export async function resolveSeason(input: {
  scope: LeaderboardScope;
  seasonKey?: string;
  now: Date;
  cursor?: LeaderboardCursorPayload;
  database: PrismaClient;
}): Promise<LeaderboardSeason> {
  if (input.cursor) {
    const season = await getLeaderboardSeasonById(input.cursor.seasonId, input.database);
    if (season.scope !== input.scope) {
      throw new LeaderboardError(
        "LEADERBOARD_CURSOR_INVALID",
        "Leaderboard cursor does not match the requested scope.",
      );
    }
    if (input.seasonKey && input.seasonKey !== season.seasonKey) {
      throw new LeaderboardError(
        "LEADERBOARD_CURSOR_INVALID",
        "Leaderboard cursor does not match the requested season.",
      );
    }
    return season;
  }
  if (input.seasonKey) {
    const selected = await getLeaderboardSeasonByKey({
      scope: input.scope,
      seasonKey: input.seasonKey,
    }, input.database);
    if (selected.status === "CLOSED") return selected;
    const currentWindow = await ensureLeaderboardSeason({
      scope: input.scope,
      asOf: input.now,
    }, input.database);
    if (selected.id !== currentWindow.id && selected.status !== "CLOSED") {
      throw new LeaderboardError(
        "LEADERBOARD_SEASON_NOT_FINALIZABLE",
        "Historical season is not closed and finalized yet.",
      );
    }
    return selected;
  }
  return ensureLeaderboardSeason({
    scope: input.scope,
    asOf: input.now,
  }, input.database);
}

export function buildBaseEntryWhere(
  snapshotId: string,
  blockedUserIds: readonly string[],
): Prisma.LeaderboardSnapshotEntryWhereInput {
  return {
    snapshotId,
    userId: {
      not: null,
      ...(blockedUserIds.length > 0 ? { notIn: [...blockedUserIds] } : {}),
    },
    user: { is: { accountStatus: "ACTIVE" } },
  };
}

export async function getBlockedUserIds(
  viewerId: string,
  database: PrismaClient,
): Promise<string[]> {
  const blocks = await database.userBlock.findMany({
    where: {
      OR: [
        { blockerId: viewerId },
        { blockedId: viewerId },
      ],
    },
    select: { blockerId: true, blockedId: true },
  });
  return [...new Set(blocks.map((block) =>
    block.blockerId === viewerId ? block.blockedId : block.blockerId))];
}

function cursorExpiry(snapshot: LeaderboardSnapshot): number | null {
  return snapshot.snapshotType === "LIVE"
    ? snapshot.generatedAt.getTime() + LEADERBOARD_LIVE_CURSOR_RETENTION_MS
    : null;
}

export async function validateCursorSnapshot(input: {
  cursor: LeaderboardCursorPayload;
  season: LeaderboardSeason;
  database: PrismaClient;
  now: Date;
}): Promise<LeaderboardSnapshot> {
  const snapshot = await getLeaderboardSnapshotById(
    input.cursor.snapshotId,
    input.database,
  );
  const seasonScope = leaderboardSeasonToWindow(input.season).scope;
  if (
    !snapshot
    || snapshot.seasonId !== input.season.id
    || snapshot.status !== "READY"
    || !isLeaderboardSnapshotScoringCurrent(snapshot, seasonScope)
  ) {
    throw new LeaderboardError(
      "LEADERBOARD_CURSOR_EXPIRED",
      "Leaderboard cursor snapshot is no longer available. Request a new first page.",
    );
  }
  const expectedExpiry = cursorExpiry(snapshot);
  if (input.cursor.expiresAt !== expectedExpiry) {
    throw new LeaderboardError(
      "LEADERBOARD_CURSOR_INVALID",
      "Leaderboard cursor does not match its snapshot.",
    );
  }
  if (expectedExpiry !== null && expectedExpiry <= input.now.getTime()) {
    throw new LeaderboardError(
      "LEADERBOARD_CURSOR_EXPIRED",
      "Leaderboard cursor has expired. Request a new first page.",
    );
  }
  const boundary = await input.database.leaderboardSnapshotEntry.findFirst({
    where: {
      snapshotId: snapshot.id,
      userId: input.cursor.userId,
    },
    select: { rank: true, score: true },
  });
  if (
    !boundary
    || boundary.rank !== input.cursor.rank
    || boundary.score.toString() !== input.cursor.score
  ) {
    throw new LeaderboardError(
      "LEADERBOARD_CURSOR_INVALID",
      "Leaderboard cursor position is invalid.",
    );
  }
  return snapshot;
}

export async function getLeaderboardPage(input: {
  viewerId: string;
  scope: LeaderboardScope;
  seasonKey?: string;
  limit?: unknown;
  cursor?: LeaderboardCursorPayload;
  now?: Date;
  database?: PrismaClient;
}): Promise<{
  scope: LeaderboardScope;
  season: LeaderboardSeasonDto;
  generatedAt: string;
  scoreThrough: string;
  isStale: boolean;
  totalRankedUsers: number;
  entries: PublicLeaderboardEntry[];
  nextCursor: string | null;
}> {
  const database = input.database ?? getPrisma() as PrismaClient;
  const now = input.now ? new Date(input.now) : new Date();
  if (!(input.viewerId && Number.isFinite(now.getTime()))) {
    throw new LeaderboardError(
      "LEADERBOARD_INVALID_INPUT",
      "Authenticated viewer and valid read time are required.",
    );
  }
  const limit = parsePageSize(input.limit);
  const season = await resolveSeason({
    scope: input.scope,
    ...(input.seasonKey ? { seasonKey: input.seasonKey } : {}),
    now,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    database,
  });
  let snapshot: LeaderboardSnapshot;
  let isStale = false;
  if (input.cursor) {
    snapshot = await validateCursorSnapshot({
      cursor: input.cursor,
      season,
      database,
      now,
    });
    isStale = snapshot.snapshotType === "LIVE"
      && now.getTime() - snapshot.generatedAt.getTime()
        > 5 * 60 * 1000;
  } else {
    const readable = await getReadableLeaderboardSnapshot({
      season,
      now,
      database,
    });
    snapshot = readable.snapshot;
    isStale = readable.isStale;
  }
  const blockedUserIds = await getBlockedUserIds(input.viewerId, database);
  const baseWhere = buildBaseEntryWhere(snapshot.id, blockedUserIds);
  const cursorWhere: Prisma.LeaderboardSnapshotEntryWhereInput | undefined =
    input.cursor
      ? {
        OR: [
          { rank: { gt: input.cursor.rank } },
          {
            rank: input.cursor.rank,
            score: { lt: BigInt(input.cursor.score) },
          },
          {
            rank: input.cursor.rank,
            score: BigInt(input.cursor.score),
            userId: { gt: input.cursor.userId },
          },
        ],
      }
      : undefined;
  const where: Prisma.LeaderboardSnapshotEntryWhereInput = cursorWhere
    ? { AND: [baseWhere, cursorWhere] }
    : baseWhere;
  const [rows, totalRankedUsers] = await Promise.all([
    database.leaderboardSnapshotEntry.findMany({
      where,
      orderBy: [
        { rank: "asc" },
        { score: "desc" },
        { userId: "asc" },
      ],
      take: limit + 1,
      select: {
        rank: true,
        tieSize: true,
        userId: true,
        score: true,
        levelSnapshot: true,
        user: { select: { name: true, avatar: true, avatarUrl: true } },
      },
    }),
    database.leaderboardSnapshotEntry.count({ where: baseWhere }),
  ]);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const entries = pageRows.flatMap((row): PublicLeaderboardEntry[] => {
    if (row.userId === null) return [];
    return [{
      rank: row.rank,
      tieSize: row.tieSize,
      level: row.levelSnapshot,
      score: decodeLeaderboardScore(row.score),
      displayName: safePublicDisplayName(row.user?.name),
      avatarUrl: safePublicAvatarUrl(row.user?.avatarUrl || row.user?.avatar),
      isViewer: row.userId === input.viewerId,
    }];
  });
  let nextCursor: string | null = null;
  const last = pageRows[pageRows.length - 1];
  const expiresAt = cursorExpiry(snapshot);
  if (
    hasMore
    && last
    && last.userId
    && (expiresAt === null || expiresAt > now.getTime())
  ) {
    nextCursor = encodeLeaderboardCursor({
      version: 1,
      snapshotId: snapshot.id,
      seasonId: season.id,
      rank: last.rank,
      score: last.score.toString(),
      userId: last.userId,
      expiresAt,
    });
  }
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
}

export async function getMyLeaderboardRank(input: {
  viewerId: string;
  scope: LeaderboardScope;
  seasonKey?: string;
  now?: Date;
  database?: PrismaClient;
}): Promise<{
  scope: LeaderboardScope;
  season: LeaderboardSeasonDto;
  rank: number | null;
  score: number;
  tieSize: number | null;
  totalRankedUsers: number;
  notRanked: boolean;
  snapshotGeneratedAt: string;
}> {
  const database = input.database ?? getPrisma() as PrismaClient;
  const now = input.now ? new Date(input.now) : new Date();
  if (!(input.viewerId && Number.isFinite(now.getTime()))) {
    throw new LeaderboardError(
      "LEADERBOARD_INVALID_INPUT",
      "Authenticated viewer and valid read time are required.",
    );
  }
  const season = await resolveSeason({
    scope: input.scope,
    ...(input.seasonKey ? { seasonKey: input.seasonKey } : {}),
    now,
    database,
  });
  const { snapshot } = await getReadableLeaderboardSnapshot({
    season,
    now,
    database,
  });
  const blockedUserIds = await getBlockedUserIds(input.viewerId, database);
  const seasonWindow = leaderboardSeasonToWindow(season);
  // Own-score display must reflect the canonical ledger immediately even when
  // a LIVE ranking snapshot is still being rebuilt in the background. Use a
  // 1 ms exclusive upper bound so a reward committed at `now` is included.
  const liveScoreThrough = input.scope === "ALL_TIME"
    ? new Date(now.getTime() + 1)
    : new Date(Math.min(
        now.getTime() + 1,
        seasonWindow.endsAt?.getTime() ?? now.getTime() + 1,
      ));
  const [entry, totalRankedUsers, scoreResult] = await Promise.all([
    database.leaderboardSnapshotEntry.findFirst({
      where: {
        snapshotId: snapshot.id,
        userId: input.viewerId,
      },
      select: { rank: true, score: true, tieSize: true },
    }),
    database.leaderboardSnapshotEntry.count({
      where: buildBaseEntryWhere(snapshot.id, blockedUserIds),
    }),
    readUserLeaderboardScore({
      userId: input.viewerId,
      scope: input.scope,
      season: seasonWindow,
      scoreThrough: liveScoreThrough,
    }, database),
  ]);
  if (entry) {
    return {
      scope: input.scope,
      season: seasonDto(season),
      rank: entry.rank,
      // Rank/tie come from the current snapshot; the visible point total comes
      // straight from the immutable ledger so it never lags behind completion.
      score: scoreResult.score,
      tieSize: entry.tieSize,
      totalRankedUsers,
      notRanked: false,
      snapshotGeneratedAt: snapshot.generatedAt.toISOString(),
    };
  }
  return {
    scope: input.scope,
    season: seasonDto(season),
    rank: null,
    score: scoreResult.score,
    tieSize: null,
    totalRankedUsers,
    notRanked: true,
    snapshotGeneratedAt: snapshot.generatedAt.toISOString(),
  };
}

export function isLeaderboardScope(value: unknown): value is LeaderboardScope {
  return typeof value === "string"
    && (LEADERBOARD_SCOPES as readonly string[]).includes(value);
}