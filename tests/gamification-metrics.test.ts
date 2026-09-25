import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import test from "node:test";
import {
  GAMIFICATION_METRIC_IDS,
  GamificationError,
  getGamificationMetricValue,
} from "../server/features/gamification/index.js";

function createReadOnlyDatabase() {
  const seen: {
    focusWhere?: Record<string, unknown>;
    groupWhere?: Record<string, unknown>;
    writes: number;
  } = { writes: 0 };
  const database = {
    $transaction: async (
      callback: (tx: Record<string, unknown>) => Promise<unknown>,
    ) =>
      callback({
        studyPointsBalanceProjection: {
          findUnique: async () => ({
            focusPoints: 12,
            masteryPoints: 25,
            progressPoints: 8,
            consistencyPoints: 4,
            totalPoints: 49,
            ledgerEntryCount: 6,
            projectionVersion: 3,
          }),
        },
        pointsLog: {
          aggregate: async () => ({ _sum: { points: 130 } }),
        },
        studyPointsLedgerEntry: {
          count: async () => 0,
        },
      }),
    focusSession: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        seen.focusWhere = where;
        return 3;
      },
      aggregate: async ({ where }: { where: Record<string, unknown> }) => {
        seen.focusWhere = where;
        return { _sum: { activeSeconds: 8_400 } };
      },
      create: async () => {
        seen.writes += 1;
        throw new Error("Metric evaluation must not create Focus sessions.");
      },
    },
    groupFocusParticipantSummary: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        seen.groupWhere = where;
        return 2;
      },
      aggregate: async ({ where }: { where: Record<string, unknown> }) => {
        seen.groupWhere = where;
        return { _sum: { verifiedFocusSeconds: 3_600 } };
      },
      create: async () => {
        seen.writes += 1;
        throw new Error("Metric evaluation must not create group summaries.");
      },
    },
  } as unknown as PrismaClient;
  return { database, seen };
}

test("providers read canonical points, personal Focus, and Group Focus values", async () => {
  const oldReadMode = process.env.STUDY_POINTS_READ_MODE;
  process.env.STUDY_POINTS_READ_MODE = "LEGACY_ONLY";
  try {
    const { database, seen } = createReadOnlyDatabase();
    const asOf = new Date("2026-09-25T10:00:00.000Z");
    const pointTotal = await getGamificationMetricValue(
      { userId: "user-1", metricId: GAMIFICATION_METRIC_IDS.pointsTotal, asOf },
      database,
    );
    const focusPoints = await getGamificationMetricValue(
      { userId: "user-1", metricId: GAMIFICATION_METRIC_IDS.pointsFocus, asOf },
      database,
    );
    const completedSessions = await getGamificationMetricValue(
      { userId: "user-1", metricId: GAMIFICATION_METRIC_IDS.focusCompletedSessions, asOf },
      database,
    );
    const focusSeconds = await getGamificationMetricValue(
      { userId: "user-1", metricId: GAMIFICATION_METRIC_IDS.focusVerifiedSeconds, asOf },
      database,
    );
    const groupRuns = await getGamificationMetricValue(
      { userId: "user-1", metricId: GAMIFICATION_METRIC_IDS.groupFocusCompletedRuns, asOf },
      database,
    );
    const groupSeconds = await getGamificationMetricValue(
      { userId: "user-1", metricId: GAMIFICATION_METRIC_IDS.groupFocusVerifiedSeconds, asOf },
      database,
    );

    assert.equal(pointTotal.value, 130);
    assert.equal(focusPoints.value, 12);
    assert.equal(completedSessions.value, 3);
    assert.equal(focusSeconds.value, 8_400);
    assert.equal(groupRuns.value, 2);
    assert.equal(groupSeconds.value, 3_600);
    assert.equal(pointTotal.sourceVersion, "study-points-read-model-v1");
    assert.equal(focusSeconds.sourceVersion, "focus-session-canonical-v1");
    assert.equal(groupSeconds.sourceVersion, "group-focus-participant-summary-v1");
    assert.deepEqual(pointTotal.asOf, asOf);
    assert.deepEqual(
      (seen.focusWhere?.actualEndedAt as { lte: Date }).lte,
      asOf,
    );
    assert.deepEqual(
      (seen.groupWhere?.run as { runtimeEndedAt: { lte: Date } })
        .runtimeEndedAt.lte,
      asOf,
    );
    assert.equal(seen.writes, 0);
  } finally {
    if (oldReadMode === undefined) {
      delete process.env.STUDY_POINTS_READ_MODE;
    } else {
      process.env.STUDY_POINTS_READ_MODE = oldReadMode;
    }
  }
});

test("unavailable and unknown metrics fail before accessing database state", async () => {
  let databaseTouched = false;
  const forbiddenDatabase = new Proxy({}, {
    get() {
      databaseTouched = true;
      throw new Error("Database should not be read for unavailable metrics.");
    },
  }) as PrismaClient;
  const asOf = new Date("2026-09-25T10:00:00.000Z");

  await assert.rejects(
    getGamificationMetricValue(
      {
        userId: "user-1",
        metricId: GAMIFICATION_METRIC_IDS.consistencyQualifyingDays,
        asOf,
      },
      forbiddenDatabase,
    ),
    (error: unknown) =>
      error instanceof GamificationError
      && error.code === "GAMIFICATION_METRIC_PROVIDER_UNAVAILABLE",
  );
  await assert.rejects(
    getGamificationMetricValue(
      { userId: "user-1", metricId: "metrics.unknown", asOf },
      forbiddenDatabase,
    ),
    (error: unknown) =>
      error instanceof GamificationError
      && error.code === "GAMIFICATION_METRIC_NOT_FOUND",
  );
  assert.equal(databaseTouched, false);
});