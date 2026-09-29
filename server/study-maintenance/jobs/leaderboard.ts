import type { PrismaClient } from "@prisma/client";
import { reconcileLeaderboardSnapshot } from "../../features/leaderboard/reconciliation.js";
import { reprojectLeaderboardSnapshot } from "../../features/leaderboard/d1Outbox.js";
import type { InspectionResult, MaintenanceAdapter } from "../core/types.js";

export type LeaderboardSnapshotItem = {
  id: string;
  seasonId: string;
  snapshotId?: string;
};

export function createLeaderboardSnapshotAdapter(input: {
  database: PrismaClient;
  seasonId: string;
  snapshotId?: string;
  asOf: string;
}): MaintenanceAdapter<LeaderboardSnapshotItem> {
  const item: LeaderboardSnapshotItem = {
    id: input.snapshotId ?? input.seasonId,
    seasonId: input.seasonId,
    ...(input.snapshotId ? { snapshotId: input.snapshotId } : {}),
  };
  const inspect = async (): Promise<InspectionResult> => {
    const result = await reconcileLeaderboardSnapshot({
      seasonId: input.seasonId,
      ...(input.snapshotId ? { snapshotId: input.snapshotId } : {}),
      now: new Date(input.asOf),
      repair: false,
    }, input.database);
    const anomaly = result.anomalies[0];
    return {
      status: result.anomalies.length ? "DRIFT" : "IN_SYNC",
      wouldChange: result.anomalies.length > 0,
      code: anomaly,
    };
  };
  const apply = async (): Promise<InspectionResult> => {
    const result = await reconcileLeaderboardSnapshot({
      seasonId: input.seasonId,
      ...(input.snapshotId ? { snapshotId: input.snapshotId } : {}),
      now: new Date(input.asOf),
      repair: true,
    }, input.database);
    return {
      status: result.repaired ? "REPAIRED" : result.anomalies.length ? "DRIFT" : "IN_SYNC",
      changed: result.repaired,
      wouldChange: !result.repaired && result.anomalies.length > 0,
      code: result.anomalies[0],
    };
  };
  return {
    async discoverBatch({ cursor }) {
      return cursor
        ? { items: [], nextCursor: null }
        : { items: [item], nextCursor: null };
    },
    inspect,
    apply,
  };
}

export function createLeaderboardD1RebuildAdapter(input: {
  database: PrismaClient;
  snapshotId: string;
}): MaintenanceAdapter<{ id: string }> {
  return {
    async discoverBatch({ cursor }) {
      return cursor
        ? { items: [], nextCursor: null }
        : { items: [{ id: input.snapshotId }], nextCursor: null };
    },
    async inspect(item) {
      const snapshot = await input.database.leaderboardSnapshot.findUnique({
        where: { id: item.id },
        select: { status: true },
      });
      if (!snapshot || snapshot.status !== "READY") {
        throw new Error("MAINTENANCE_SAFE: The selected canonical leaderboard snapshot is missing or not READY.");
      }
      return { status: "REPROJECT_REQUIRED", wouldChange: true };
    },
    async apply(item) {
      const queued = await reprojectLeaderboardSnapshot(item.id, input.database);
      return {
        status: queued > 0 ? "REPROJECTED" : "ALREADY_QUEUED",
        changed: queued > 0,
        skipped: queued === 0,
      };
    },
  };
}