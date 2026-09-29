import assert from "node:assert/strict";
import type { Prisma, PrismaClient } from "@prisma/client";
import { test } from "node:test";
import { evaluateAchievementProgress } from "../server/features/gamification/achievementEvaluation.js";
import { getGamificationDefinitionBundle } from "../server/features/gamification/definitions.js";
import { persistAchievementProgressInTransaction } from "../server/features/gamification/achievementProgress.js";
import type { AchievementProgressSnapshot } from "../server/features/gamification/achievementProgress.js";
import { createAchievementAdapter } from "../server/study-maintenance/jobs/achievements.js";

const ruleSetVersion = "gamification-v1";
const pointsAchievementId = "achievement.points.first_100";
const focusAchievementId = "achievement.focus.first_verified_session";
const groupAchievementId = "achievement.group_focus.first_verified_run";
const asOf = new Date("2026-09-28T12:00:00.000Z");

function evaluate() {
  const definitions = getGamificationDefinitionBundle(ruleSetVersion)
    .achievementDefinitions;
  return evaluateAchievementProgress({
    ruleSetVersion,
    definitions,
    metricValues: new Map([
      ["points.total", 100],
      ["focus.completed_sessions", 0],
      ["group_focus.completed_runs", 1],
    ]),
    existingProgress: [{
      id: "progress-points",
      achievementId: pointsAchievementId,
      ruleSetVersion,
      metricId: "points.total",
      valueType: "INTEGER",
      currentValue: 99n,
      targetValue: 100n,
      completed: false,
    }],
    unlockedAchievementIds: new Set([groupAchievementId]),
  });
}

function snapshot(): AchievementProgressSnapshot {
  return {
    ruleSetVersion,
    definitionChecksum: "source-verified-checksum",
    asOf,
    entries: evaluate(),
  };
}

test("shared achievement evaluator identifies repairable progress and review-only unlock history", () => {
  const entries = evaluate();
  const points = entries.find(({ definition }) => definition.id === pointsAchievementId);
  const focus = entries.find(({ definition }) => definition.id === focusAchievementId);
  const group = entries.find(({ definition }) => definition.id === groupAchievementId);

  assert.ok(points);
  assert.equal(points.current.value, 100n);
  assert.equal(points.completed, true);
  assert.equal(points.progressStatus, "DRIFT");
  assert.equal(points.unlockReviewRequired, true);

  assert.ok(focus);
  assert.equal(focus.completed, false);
  assert.equal(focus.progressStatus, "MISSING");
  assert.equal(focus.unlockReviewRequired, false);

  assert.ok(group);
  assert.equal(group.completed, true);
  assert.equal(group.progressStatus, "MISSING");
  assert.equal(group.unlocked, true);
  assert.equal(group.unlockReviewRequired, false);
});

test("progress persistence only needs the progress delegate and never writes unlock history", async () => {
  const calls: { creates: Array<{ data: unknown[] }>; updates: Array<{ where: unknown; data: unknown }> } = {
    creates: [],
    updates: [],
  };
  const writer = {
    userAchievementProgress: {
      async createMany(args: { data: unknown[] }) {
        calls.creates.push(args);
        return { count: args.data.length };
      },
      async update(args: { where: unknown; data: unknown }) {
        calls.updates.push(args);
        return {};
      },
    },
  } as unknown as Pick<Prisma.TransactionClient, "userAchievementProgress">;

  const result = await persistAchievementProgressInTransaction({
    tx: writer,
    userId: "maintenance-user",
    snapshot: snapshot(),
  });

  assert.deepEqual(result, { created: 2, updated: 1 });
  assert.equal(calls.creates.length, 1);
  assert.equal(calls.creates[0]?.data.length, 2);
  assert.equal(calls.updates.length, 1);
  assert.deepEqual(calls.updates[0]?.where, { id: "progress-points" });
  assert.equal("userAchievement" in writer, false);
});

test("achievement adapter keeps audit read-only and reports unlock review separately from progress repair", async () => {
  const db = {
    user: {
      async findUnique() {
        return { id: "maintenance-user" };
      },
    },
  } as unknown as PrismaClient;
  const result = { snapshot: snapshot(), created: 0, updated: 0 };
  let inspected = 0;
  let rebuilt = 0;
  const adapter = createAchievementAdapter({
    database: db,
    async inspect(input) {
      inspected += 1;
      assert.equal(input.asOf.toISOString(), asOf.toISOString());
      return result;
    },
    async rebuild(input) {
      rebuilt += 1;
      assert.equal(input.asOf.toISOString(), asOf.toISOString());
      return { ...result, created: 1 };
    },
  });

  const page = await adapter.discoverBatch({
    cursor: null,
    limit: 10,
    scope: JSON.stringify({ userId: "maintenance-user" }),
  });
  assert.deepEqual(page.items, [{ id: "maintenance-user" }]);

  const audit = await adapter.inspect(page.items[0]!, { asOf: asOf.toISOString() });
  assert.equal(audit.status, "PROGRESS_DRIFT_UNLOCK_REVIEW");
  assert.equal(audit.wouldChange, true);
  assert.equal(audit.code, "HISTORICAL_UNLOCK_REVIEW_REQUIRED");
  assert.equal(inspected, 1);
  assert.equal(rebuilt, 0);

  const repair = await adapter.apply(page.items[0]!, { asOf: asOf.toISOString() });
  assert.equal(repair.status, "PROGRESS_REBUILT_UNLOCK_REVIEW");
  assert.equal(repair.changed, true);
  assert.equal(repair.code, "HISTORICAL_UNLOCK_REVIEW_REQUIRED");
  assert.equal(rebuilt, 1);
});