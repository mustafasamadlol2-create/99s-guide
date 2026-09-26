import {
  Prisma,
  type LeaderboardSeason,
  type LeaderboardSnapshot,
  type PrismaClient,
} from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { LeaderboardError } from "./errors.js";
import { encodeLeaderboardCursor } from "./cursor.js";
import { getLeaderboardSnapshotById, getReadableLeaderboardSnapshot, LEADERBOARD_LIVE_CURSOR_RETENTION_MS } from "./snapshots.js";
import { getLeaderboardSeasonById, getLeaderboardSeasonByKey, ensureLeaderboardSeason, leaderboardSeasonToWindow } from "./seasons.js";
import { decodeLeaderboardScore, readUserLeaderboardScore } from "./scores.js";
import {
  LEADERBOARD_SCOPES,
  type LeaderboardCursorPayload,
  type LeaderboardScope,
  type PublicLeaderboardEntry,
} from "./types.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export type LeaderboardSeasonDto = {
  id: string;
  scope: LeaderboardScope;
  seasonKey: string;
  startsAt: string | null;
  endsAt: string | null;
  status: string;
};

function seasonDto(season: LeaderboardSeason): LeaderboardSeasonDto {
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

async function resolveSeason(input: {
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

function buildBaseEntryWhere(
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

async function getBlockedUserIds(
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

async function validateCursorSnapshot(input: {
  cursor: LeaderboardCursorPayload;
  season: LeaderboardSeason;
  database: PrismaClient;
  now: Date;
}): Promise<LeaderboardSnapshot> {
  const snapshot = await getLeaderboardSnapshotById(
    input.cursor.snapshotId,
    input.database,
  );
  if (
    !snapshot
    || snapshot.seasonId !== input.season.id
    || snapshot.status !== "READY"
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
      userId: row.userId,
      level: row.levelSnapshot,
      score: decodeLeaderboardScore(row.score),
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
  const [entry, totalRankedUsers] = await Promise.all([
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
  ]);
  if (entry) {
    return {
      scope: input.scope,
      season: seasonDto(season),
      rank: entry.rank,
      score: decodeLeaderboardScore(entry.score),
      tieSize: entry.tieSize,
      totalRankedUsers,
      notRanked: false,
      snapshotGeneratedAt: snapshot.generatedAt.toISOString(),
    };
  }
  const scoreResult = await readUserLeaderboardScore({
    userId: input.viewerId,
    scope: input.scope,
    season: leaderboardSeasonToWindow(season),
    scoreThrough: snapshot.scoreThrough,
  }, database);
  if (scoreResult.score > 0) {
    throw new LeaderboardError(
      "LEADERBOARD_SNAPSHOT_INCONSISTENT",
      "Positive canonical score is missing from the leaderboard snapshot.",
    );
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