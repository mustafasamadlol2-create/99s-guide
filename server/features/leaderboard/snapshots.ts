import { randomUUID } from "node:crypto";
import {
  Prisma,
  type LeaderboardSeason,
  type LeaderboardSnapshot,
  type PrismaClient,
} from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { readGamificationLevelView } from "../gamification/levelMath.js";
import { getActiveGamificationRuleSet } from "../gamification/ruleSetService.js";
import { LeaderboardError } from "./errors.js";
import {
  fingerprintLeaderboardSnapshot,
  hashLeaderboardRuleVersions,
  LEADERBOARD_RANKING_SEMANTICS_VERSION,
} from "./fingerprint.js";
import {
  acquireLeaderboardSeasonLocks,
  acquireLeaderboardSnapshotLock,
} from "./locks.js";
import {
  findSeasonWithinTransaction,
  leaderboardSeasonToWindow,
} from "./seasons.js";
import { readRankedLeaderboardScores } from "./scores.js";
import type {
  LeaderboardScope,
  LeaderboardSnapshotType,
  RankedScore,
  StudyPointsCompatibilityMode,
} from "./types.js";

export const LEADERBOARD_LIVE_FRESHNESS_MS = 5 * 60 * 1000;
export const LEADERBOARD_LIVE_CURSOR_RETENTION_MS = 15 * 60 * 1000;
const ENTRY_INSERT_BATCH_SIZE = 1000;

type Transaction = Prisma.TransactionClient;

export type SnapshotBuildOutcome = {
  snapshot: LeaderboardSnapshot | null;
  lockBusy: boolean;
  reused: boolean;
};

export type ReadableSnapshot = {
  snapshot: LeaderboardSnapshot;
  isStale: boolean;
};

function assertValidInstant(value: Date, label: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new LeaderboardError(
      "LEADERBOARD_INVALID_INPUT",
      `${label} is invalid.`,
    );
  }
}

function getScoreThrough(input: {
  season: LeaderboardSeason;
  scope: LeaderboardScope;
  snapshotType: LeaderboardSnapshotType;
  scoreThrough?: Date;
  now: Date;
}): Date {
  const { season, scope, snapshotType, now } = input;
  const through = input.scoreThrough
    ? new Date(input.scoreThrough)
    : snapshotType === "FINAL"
      ? season.endsAt
      : scope === "ALL_TIME"
        ? now
        : season.endsAt && now > season.endsAt
          ? season.endsAt
          : now;
  if (!through) {
    throw new LeaderboardError(
      "LEADERBOARD_INVALID_INPUT",
      "A bounded leaderboard season is missing its end boundary.",
    );
  }
  assertValidInstant(through, "Leaderboard score-through time");
  if (through > now) {
    throw new LeaderboardError(
      "LEADERBOARD_INVALID_INPUT",
      "Leaderboard score-through time cannot be in the future.",
    );
  }
  if (snapshotType === "FINAL" && through.getTime() !== season.endsAt?.getTime()) {
    throw new LeaderboardError(
      "LEADERBOARD_INVALID_INPUT",
      "Final leaderboard snapshots must score through the exact season end.",
    );
  }
  if (
    scope !== "ALL_TIME"
    && (
      !season.startsAt
      || !season.endsAt
      || through < season.startsAt
      || through > season.endsAt
    )
  ) {
    throw new LeaderboardError(
      "LEADERBOARD_INVALID_INPUT",
      "Leaderboard score-through time is outside the season window.",
    );
  }
  return through;
}

async function readLevelSnapshots(
  tx: Transaction,
  userIds: readonly string[],
): Promise<Map<string, number | null>> {
  const levels = new Map<string, number | null>(userIds.map((id) => [id, null]));
  if (userIds.length === 0) return levels;
  try {
    const rules = await getActiveGamificationRuleSet(tx);
    for (let offset = 0; offset < userIds.length; offset += ENTRY_INSERT_BATCH_SIZE) {
      const batch = userIds.slice(offset, offset + ENTRY_INSERT_BATCH_SIZE);
      const rows = await tx.userGamificationLevel.findMany({
        where: { userId: { in: [...batch] } },
      });
      for (const row of rows) {
        const view = readGamificationLevelView(row, rules);
        levels.set(row.userId, view?.level ?? null);
      }
    }
  } catch {
    // Level is optional leaderboard context; stale or unavailable projections
    // are omitted rather than recalculated or allowed to affect rank.
  }
  return levels;
}

async function findLatestSnapshot(
  tx: Transaction,
  seasonId: string,
  snapshotType: LeaderboardSnapshotType,
): Promise<LeaderboardSnapshot | null> {
  return tx.leaderboardSnapshot.findFirst({
    where: { seasonId, snapshotType, status: "READY" },
    orderBy: { revision: "desc" },
  });
}

export async function calculateLeaderboardSnapshotSource(input: {
  tx: Transaction;
  season: LeaderboardSeason;
  scoreThrough: Date;
  compatibilityMode?: StudyPointsCompatibilityMode;
}): Promise<{
  rows: RankedScore[];
  pointsRuleVersionSetHash: string | null;
  sourceFingerprint: string;
  compatibilityMode: StudyPointsCompatibilityMode | null;
}> {
  const { tx, season, scoreThrough } = input;
  const window = leaderboardSeasonToWindow(season);
  const scoreSet = await readRankedLeaderboardScores({
    scope: window.scope,
    season: window,
    scoreThrough,
    ...(input.compatibilityMode
      ? { compatibilityMode: input.compatibilityMode }
      : {}),
  }, tx);
  const levelSnapshots = await readLevelSnapshots(
    tx,
    scoreSet.rows.map((row) => row.userId),
  );
  const rows: RankedScore[] = scoreSet.rows.map((row) => ({
    ...row,
    levelSnapshot: levelSnapshots.get(row.userId) ?? null,
  }));
  const pointsRuleVersionSetHash = hashLeaderboardRuleVersions(scoreSet.ruleVersions);
  const sourceFingerprint = fingerprintLeaderboardSnapshot({
    season,
    scoreThrough,
    rows,
    pointsRuleVersionSetHash,
    compatibilityMode: scoreSet.compatibilityMode,
  });
  return {
    rows,
    pointsRuleVersionSetHash,
    sourceFingerprint,
    compatibilityMode: scoreSet.compatibilityMode,
  };
}

async function buildSnapshotInTransaction(input: {
  tx: Transaction;
  season: LeaderboardSeason;
  snapshotType: LeaderboardSnapshotType;
  scoreThrough: Date;
  generatedAt: Date;
  compatibilityMode?: StudyPointsCompatibilityMode;
  forceRevision?: boolean;
}): Promise<{ snapshot: LeaderboardSnapshot; reused: boolean }> {
  const { tx, season, snapshotType, scoreThrough, generatedAt } = input;
  const source = await calculateLeaderboardSnapshotSource({
    tx,
    season,
    scoreThrough,
    ...(input.compatibilityMode
      ? { compatibilityMode: input.compatibilityMode }
      : {}),
  });
  const rankedRows = source.rows;
  const { pointsRuleVersionSetHash, sourceFingerprint } = source;
  const latest = await findLatestSnapshot(tx, season.id, snapshotType);
  if (
    !input.forceRevision
    &&
    latest
    && latest.sourceFingerprint === sourceFingerprint
    && latest.scoreThrough.getTime() === scoreThrough.getTime()
  ) {
    return { snapshot: latest, reused: true };
  }
  const revisions = await tx.leaderboardSnapshot.aggregate({
    where: { seasonId: season.id, snapshotType },
    _max: { revision: true },
  });
  const revision = (revisions._max.revision ?? 0) + 1;
  const snapshot = await tx.leaderboardSnapshot.create({
    data: {
      id: randomUUID(),
      seasonId: season.id,
      snapshotType,
      status: "READY",
      generatedAt,
      scoreThrough,
      sourceFingerprint,
      entryCount: rankedRows.length,
      rankingSemanticsVersion: LEADERBOARD_RANKING_SEMANTICS_VERSION,
      pointsRuleVersionSetHash,
      revision,
      ...(snapshotType === "FINAL" && latest
        ? { supersedesSnapshotId: latest.id }
        : {}),
    },
  });
  for (let offset = 0; offset < rankedRows.length; offset += ENTRY_INSERT_BATCH_SIZE) {
    const batch = rankedRows.slice(offset, offset + ENTRY_INSERT_BATCH_SIZE);
    await tx.leaderboardSnapshotEntry.createMany({
      data: batch.map((row) => ({
        id: randomUUID(),
        snapshotId: snapshot.id,
        userId: row.userId,
        score: row.score,
        rank: row.rank,
        tieSize: row.tieSize,
        levelSnapshot: row.levelSnapshot,
      })),
    });
  }
  if (snapshotType === "LIVE") {
    const cutoff = new Date(
      generatedAt.getTime() - LEADERBOARD_LIVE_CURSOR_RETENTION_MS,
    );
    await tx.leaderboardSnapshot.deleteMany({
      where: {
        seasonId: season.id,
        snapshotType: "LIVE",
        id: { not: snapshot.id },
        generatedAt: { lt: cutoff },
      },
    });
  }
  return { snapshot, reused: false };
}

export async function buildLeaderboardSnapshot(input: {
  seasonId: string;
  snapshotType: LeaderboardSnapshotType;
  scoreThrough?: Date;
  now?: Date;
  tryLock?: boolean;
  skipIfFresh?: boolean;
  compatibilityMode?: StudyPointsCompatibilityMode;
}, database: PrismaClient = getPrisma() as PrismaClient): Promise<SnapshotBuildOutcome> {
  const now = input.now ? new Date(input.now) : new Date();
  assertValidInstant(now, "Leaderboard build time");
  return database.$transaction(async (tx) => {
    const locked = await acquireLeaderboardSnapshotLock(
      tx,
      input.seasonId,
      input.snapshotType,
      input.tryLock === true,
    );
    if (!locked) {
      return { snapshot: null, lockBusy: true, reused: false };
    }
    const season = await findSeasonWithinTransaction(input.seasonId, tx);
    const scope = leaderboardSeasonToWindow(season).scope;
    if (
      input.snapshotType === "FINAL"
      && (
        scope === "ALL_TIME"
        || season.status !== "CLOSED"
      )
    ) {
      throw new LeaderboardError(
        "LEADERBOARD_SEASON_NOT_FINALIZABLE",
        "Only a closed, time-bounded season can have a final snapshot.",
      );
    }
    const latest = await findLatestSnapshot(tx, season.id, input.snapshotType);
    if (
      input.skipIfFresh
      && latest
      && now.getTime() - latest.generatedAt.getTime()
        <= LEADERBOARD_LIVE_FRESHNESS_MS
    ) {
      return { snapshot: latest, lockBusy: false, reused: true };
    }
    const scoreThrough = getScoreThrough({
      season,
      scope,
      snapshotType: input.snapshotType,
      scoreThrough: input.scoreThrough,
      now,
    });
    const built = await buildSnapshotInTransaction({
      tx,
      season,
      snapshotType: input.snapshotType,
      scoreThrough,
      generatedAt: now,
      ...(input.compatibilityMode
        ? { compatibilityMode: input.compatibilityMode }
        : {}),
    });
    return {
      snapshot: built.snapshot,
      lockBusy: false,
      reused: built.reused,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function rebuildLeaderboardSnapshot(input: {
  seasonId: string;
  now?: Date;
  compatibilityMode?: StudyPointsCompatibilityMode;
  forceRevision?: boolean;
}, database: PrismaClient = getPrisma() as PrismaClient): Promise<LeaderboardSnapshot> {
  const now = input.now ? new Date(input.now) : new Date();
  assertValidInstant(now, "Leaderboard rebuild time");
  return database.$transaction(async (tx) => {
    await acquireLeaderboardSeasonLocks(tx, input.seasonId, ["LIVE", "FINAL"]);
    const season = await findSeasonWithinTransaction(input.seasonId, tx);
    const scope = leaderboardSeasonToWindow(season).scope;
    const snapshotType: LeaderboardSnapshotType =
      season.status === "CLOSED" ? "FINAL" : "LIVE";
    if (
      snapshotType === "FINAL"
      && (scope === "ALL_TIME" || !season.endsAt)
    ) {
      throw new LeaderboardError(
        "LEADERBOARD_SEASON_CONFIGURATION_CONFLICT",
        "Closed leaderboard season does not have a bounded end.",
      );
    }
    const through = snapshotType === "FINAL"
      ? season.endsAt!
      : getScoreThrough({
        season,
        scope,
        snapshotType,
        now,
      });
    const result = await buildSnapshotInTransaction({
      tx,
      season,
      snapshotType,
      scoreThrough: through,
      generatedAt: now,
      ...(input.compatibilityMode
        ? { compatibilityMode: input.compatibilityMode }
        : {}),
      ...(input.forceRevision ? { forceRevision: true } : {}),
    });
    return result.snapshot;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function getLatestLeaderboardSnapshot(
  seasonId: string,
  snapshotType: LeaderboardSnapshotType,
  database: PrismaClient = getPrisma() as PrismaClient,
): Promise<LeaderboardSnapshot | null> {
  return database.leaderboardSnapshot.findFirst({
    where: { seasonId, snapshotType, status: "READY" },
    orderBy: { revision: "desc" },
  });
}

export async function getLeaderboardSnapshotById(
  snapshotId: string,
  database: PrismaClient = getPrisma() as PrismaClient,
): Promise<LeaderboardSnapshot | null> {
  return database.leaderboardSnapshot.findUnique({
    where: { id: snapshotId },
  });
}

export async function getReadableLeaderboardSnapshot(input: {
  season: LeaderboardSeason;
  now?: Date;
  database?: PrismaClient;
}): Promise<ReadableSnapshot> {
  const database = input.database ?? getPrisma() as PrismaClient;
  const now = input.now ? new Date(input.now) : new Date();
  assertValidInstant(now, "Leaderboard read time");
  const scope = leaderboardSeasonToWindow(input.season).scope;
  if (input.season.status === "CLOSED") {
    const snapshot = await getLatestLeaderboardSnapshot(
      input.season.id,
      "FINAL",
      database,
    );
    if (!snapshot) {
      throw new LeaderboardError(
        "LEADERBOARD_SNAPSHOT_NOT_FOUND",
        "Closed season does not have a final leaderboard snapshot.",
      );
    }
    return { snapshot, isStale: false };
  }
  const initial = await getLatestLeaderboardSnapshot(
    input.season.id,
    "LIVE",
    database,
  );
  if (
    initial
    && now.getTime() - initial.generatedAt.getTime()
      <= LEADERBOARD_LIVE_FRESHNESS_MS
  ) {
    return { snapshot: initial, isStale: false };
  }
  const build = await buildLeaderboardSnapshot({
    seasonId: input.season.id,
    snapshotType: "LIVE",
    now,
    tryLock: true,
    skipIfFresh: true,
  }, database);
  if (build.snapshot) {
    return {
      snapshot: build.snapshot,
      isStale: now.getTime() - build.snapshot.generatedAt.getTime()
        > LEADERBOARD_LIVE_FRESHNESS_MS,
    };
  }
  if (build.lockBusy && initial) {
    return { snapshot: initial, isStale: true };
  }
  if (build.lockBusy) {
    const waited = await buildLeaderboardSnapshot({
      seasonId: input.season.id,
      snapshotType: "LIVE",
      now,
      skipIfFresh: true,
    }, database);
    if (waited.snapshot) {
      return {
        snapshot: waited.snapshot,
        isStale: now.getTime() - waited.snapshot.generatedAt.getTime()
          > LEADERBOARD_LIVE_FRESHNESS_MS,
      };
    }
  }
  throw new LeaderboardError(
    "LEADERBOARD_SNAPSHOT_NOT_FOUND",
    `No readable ${scope} leaderboard snapshot is available.`,
  );
}

export async function finalizeLeaderboardSeason(input: {
  seasonId: string;
  now?: Date;
  compatibilityMode?: StudyPointsCompatibilityMode;
}, database: PrismaClient = getPrisma() as PrismaClient): Promise<{
  season: LeaderboardSeason;
  snapshot: LeaderboardSnapshot;
  reused: boolean;
}> {
  const now = input.now ? new Date(input.now) : new Date();
  assertValidInstant(now, "Leaderboard finalization time");
  return database.$transaction(async (tx) => {
    await acquireLeaderboardSeasonLocks(tx, input.seasonId, ["LIVE", "FINAL"]);
    const season = await findSeasonWithinTransaction(input.seasonId, tx);
    const scope = leaderboardSeasonToWindow(season).scope;
    if (scope === "ALL_TIME" || !season.endsAt || !season.startsAt) {
      throw new LeaderboardError(
        "LEADERBOARD_SEASON_NOT_FINALIZABLE",
        "All-time or unbounded seasons cannot be finalized.",
      );
    }
    if (now < season.endsAt) {
      throw new LeaderboardError(
        "LEADERBOARD_SEASON_NOT_FINALIZABLE",
        "Leaderboard season has not ended.",
      );
    }
    const latestFinal = await findLatestSnapshot(tx, season.id, "FINAL");
    if (season.status === "CLOSED" && latestFinal) {
      return { season, snapshot: latestFinal, reused: true };
    }
    const result = await buildSnapshotInTransaction({
      tx,
      season,
      snapshotType: "FINAL",
      scoreThrough: season.endsAt,
      generatedAt: now,
      ...(input.compatibilityMode
        ? { compatibilityMode: input.compatibilityMode }
        : {}),
    });
    const closedSeason = season.status === "CLOSED"
      ? season
      : await tx.leaderboardSeason.update({
        where: { id: season.id },
        data: { status: "CLOSED", closedAt: now },
      });
    return {
      season: closedSeason,
      snapshot: result.snapshot,
      reused: result.reused,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}