import {
  Prisma,
  type LeaderboardSeason,
  type LeaderboardSnapshot,
  type PrismaClient,
} from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { LeaderboardError } from "./errors.js";
import { leaderboardSeasonToWindow } from "./seasons.js";
import {
  calculateLeaderboardSnapshotSource,
  finalizeLeaderboardSeason,
  rebuildLeaderboardSnapshot,
} from "./snapshots.js";
import type { LeaderboardSnapshotCheck } from "./types.js";

export type LeaderboardSnapshotReconciliation = {
  seasonId: string;
  snapshotId: string | null;
  snapshotType: "LIVE" | "FINAL";
  sourceFingerprint: string | null;
  checks: LeaderboardSnapshotCheck[];
  anomalies: string[];
  repaired: boolean;
  replacementSnapshotId?: string;
};

function addCheck(
  checks: LeaderboardSnapshotCheck[],
  code: LeaderboardSnapshotCheck["code"],
  occurrences: number,
): void {
  checks.push({
    code,
    status: occurrences > 0 ? "FAIL" : "PASS",
    occurrences,
  });
}

async function readSeason(
  tx: Prisma.TransactionClient,
  seasonId: string,
): Promise<LeaderboardSeason> {
  const season = await tx.leaderboardSeason.findUnique({
    where: { id: seasonId },
  });
  if (!season) {
    throw new LeaderboardError(
      "LEADERBOARD_SEASON_NOT_FOUND",
      "Leaderboard season was not found.",
    );
  }
  return season;
}

async function inspectSnapshot(input: {
  seasonId: string;
  snapshotId?: string;
  now: Date;
  database: PrismaClient;
}): Promise<LeaderboardSnapshotReconciliation> {
  return input.database.$transaction(async (tx) => {
    const season = await readSeason(tx, input.seasonId);
    const expectedType: "LIVE" | "FINAL" =
      season.status === "CLOSED" ? "FINAL" : "LIVE";
    let snapshot: LeaderboardSnapshot | null;
    if (input.snapshotId) {
      snapshot = await tx.leaderboardSnapshot.findUnique({
        where: { id: input.snapshotId },
      });
      if (!snapshot || snapshot.seasonId !== season.id) {
        throw new LeaderboardError(
          "LEADERBOARD_SNAPSHOT_NOT_FOUND",
          "Leaderboard snapshot was not found for this season.",
        );
      }
    } else {
      snapshot = await tx.leaderboardSnapshot.findFirst({
        where: {
          seasonId: season.id,
          snapshotType: expectedType,
          status: "READY",
        },
        orderBy: { revision: "desc" },
      });
    }
    const allFinals = await tx.leaderboardSnapshot.findMany({
      where: {
        seasonId: season.id,
        snapshotType: "FINAL",
        status: "READY",
      },
      orderBy: { revision: "asc" },
      select: {
        id: true,
        revision: true,
        supersedesSnapshotId: true,
      },
    });
    const finalChainInvalid = allFinals.some((item, index) =>
      index === 0
        ? item.supersedesSnapshotId !== null
        : item.supersedesSnapshotId !== allFinals[index - 1]?.id
          || item.revision <= allFinals[index - 1]!.revision);
    const checks: LeaderboardSnapshotCheck[] = [];
    const expectedSnapshotMissing = snapshot === null;
    addCheck(checks, "SNAPSHOT_MISSING", expectedSnapshotMissing ? 1 : 0);
    addCheck(
      checks,
      "FINAL_SNAPSHOT_MISSING",
      season.status === "CLOSED" && allFinals.length === 0 ? 1 : 0,
    );
    addCheck(
      checks,
      "MULTIPLE_FINAL_SNAPSHOTS",
      allFinals.length > 1 && finalChainInvalid ? 1 : 0,
    );
    const statusMismatch =
      (season.status === "CLOSED"
        && (
          !season.endsAt
          || !season.closedAt
          || season.closedAt < season.endsAt
          || allFinals.length === 0
        ))
      || (season.status !== "CLOSED" && allFinals.length > 0);
    addCheck(checks, "SEASON_STATUS_MISMATCH", statusMismatch ? 1 : 0);
    if (!snapshot) {
      addCheck(checks, "ENTRY_COUNT_MISMATCH", 0);
      addCheck(checks, "SCORE_MISMATCH", 0);
      addCheck(checks, "RANK_MISMATCH", 0);
      addCheck(checks, "TIE_SIZE_MISMATCH", 0);
      addCheck(checks, "SOURCE_FINGERPRINT_MISMATCH", 0);
      return {
        seasonId: season.id,
        snapshotId: null,
        snapshotType: expectedType,
        sourceFingerprint: null,
        checks,
        anomalies: checks.filter((check) => check.status === "FAIL")
          .map((check) => check.code),
        repaired: false,
      };
    }

    const entries = await tx.leaderboardSnapshotEntry.findMany({
      where: { snapshotId: snapshot.id },
      select: {
        userId: true,
        score: true,
        rank: true,
        tieSize: true,
      },
    });
    addCheck(
      checks,
      "ENTRY_COUNT_MISMATCH",
      entries.length === snapshot.entryCount
        ? 0
        : Math.abs(entries.length - snapshot.entryCount) || 1,
    );
    const scope = leaderboardSeasonToWindow(season).scope;
    const scoreThrough = snapshot.snapshotType === "FINAL" && season.endsAt
      ? season.endsAt
      : snapshot.scoreThrough;
    if (!scoreThrough) {
      throw new LeaderboardError(
        "LEADERBOARD_SEASON_CONFIGURATION_CONFLICT",
        "Snapshot season is missing its scoring boundary.",
      );
    }
    const source = await calculateLeaderboardSnapshotSource({
      tx,
      season,
      scoreThrough,
    });
    const sourceFingerprintMismatch =
      snapshot.sourceFingerprint !== source.sourceFingerprint
      || snapshot.rankingSemanticsVersion !== "leaderboard-ranking-v1"
      || (
        snapshot.snapshotType === "FINAL"
        && (
          !season.endsAt
          || snapshot.scoreThrough.getTime() !== season.endsAt.getTime()
        )
      )
      || (scope === "ALL_TIME" && snapshot.snapshotType === "FINAL");
    addCheck(
      checks,
      "SOURCE_FINGERPRINT_MISMATCH",
      sourceFingerprintMismatch ? 1 : 0,
    );
    const expectedByUser = new Map(source.rows.map((row) => [row.userId, row]));
    const storedByUser = new Map(
      entries.flatMap((entry) =>
        entry.userId ? [[entry.userId, entry] as const] : []),
    );
    const userIds = new Set([...expectedByUser.keys(), ...storedByUser.keys()]);
    let scoreMismatches = 0;
    let rankMismatches = 0;
    let tieSizeMismatches = 0;
    for (const userId of userIds) {
      const expected = expectedByUser.get(userId);
      const stored = storedByUser.get(userId);
      if (!expected || !stored || BigInt(stored.score) !== expected.score) {
        scoreMismatches += 1;
      }
      if (!expected || !stored || stored.rank !== expected.rank) {
        rankMismatches += 1;
      }
      if (!expected || !stored || stored.tieSize !== expected.tieSize) {
        tieSizeMismatches += 1;
      }
    }
    addCheck(checks, "SCORE_MISMATCH", scoreMismatches);
    addCheck(checks, "RANK_MISMATCH", rankMismatches);
    addCheck(checks, "TIE_SIZE_MISMATCH", tieSizeMismatches);
    return {
      seasonId: season.id,
      snapshotId: snapshot.id,
      snapshotType: snapshot.snapshotType as "LIVE" | "FINAL",
      sourceFingerprint: source.sourceFingerprint,
      checks,
      anomalies: checks.filter((check) => check.status === "FAIL")
        .map((check) => check.code),
      repaired: false,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function reconcileLeaderboardSnapshot(input: {
  seasonId: string;
  snapshotId?: string;
  repair?: boolean;
  now?: Date;
}, database: PrismaClient = getPrisma() as PrismaClient): Promise<LeaderboardSnapshotReconciliation> {
  const now = input.now ? new Date(input.now) : new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new LeaderboardError(
      "LEADERBOARD_INVALID_INPUT",
      "Leaderboard reconciliation time is invalid.",
    );
  }
  const before = await inspectSnapshot({
    seasonId: input.seasonId,
    ...(input.snapshotId ? { snapshotId: input.snapshotId } : {}),
    now,
    database,
  });
  if (!input.repair || before.anomalies.length === 0) return before;
  const season = await readSeasonOutsideTransaction(input.seasonId, database);
  if (
    season.status === "UPCOMING"
    || (season.endsAt !== null && now < season.endsAt)
  ) {
    return before;
  }
  const replacement = season.status === "CLOSED"
    ? await rebuildLeaderboardSnapshot({
      seasonId: season.id,
      now,
      forceRevision: true,
    }, database)
    : (await finalizeLeaderboardSeason({
      seasonId: season.id,
      now,
    }, database)).snapshot;
  const after = await inspectSnapshot({
    seasonId: season.id,
    now,
    database,
  });
  return {
    ...after,
    repaired: true,
    replacementSnapshotId: replacement.id,
  };
}

async function readSeasonOutsideTransaction(
  seasonId: string,
  database: PrismaClient,
): Promise<LeaderboardSeason> {
  const season = await database.leaderboardSeason.findUnique({
    where: { id: seasonId },
  });
  if (!season) {
    throw new LeaderboardError(
      "LEADERBOARD_SEASON_NOT_FOUND",
      "Leaderboard season was not found.",
    );
  }
  return season;
}