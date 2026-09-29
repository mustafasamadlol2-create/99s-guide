import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../prisma/migrations/20260929180000_study_outbox_lifecycle/migration.sql", import.meta.url),
  "utf8",
);
const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");

test("outbox lifecycle migration retains terminal rows and bounds delivery state", () => {
  assert.match(migration, /ADD COLUMN "state" VARCHAR\(16\) NOT NULL DEFAULT 'PENDING'/u);
  assert.match(migration, /ADD COLUMN "terminalAt" TIMESTAMP\(3\)/u);
  assert.match(migration, /"state" IN \('PENDING', 'RETRY', 'BLOCKED', 'POISON', 'SUCCEEDED'\)/u);
  assert.match(migration, /"PrivateD1SyncOutbox_terminal_state_check"/u);
  assert.match(migration, /"LeaderboardD1SyncOutbox_terminal_state_check"/u);
  assert.match(migration, /leaderboard_d1_outbox_snapshot_work_generation_key/u);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/iu);
});

test("Prisma schema uses a generation-aware leaderboard outbox key", () => {
  assert.match(schema, /model LeaderboardD1SyncOutbox \{[\s\S]*?projectionGeneration Int @default\(0\)/u);
  assert.match(
    schema,
    /@@unique\(\[snapshotId, workType, chunkIndex, projectionGeneration\], map: "leaderboard_d1_outbox_snapshot_work_generation_key"\)/u,
  );
});