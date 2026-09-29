import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createOutboxAdapter } from "../server/study-maintenance/jobs/outbox.js";
import { runFocusAudit, runGroupFocusAudit } from "../server/study-maintenance/jobs/integrityAudits.js";

test("outbox replay is limited to expired leaderboard leases and leaves private D1 rows untouched", async () => {
  let queryCount = 0;
  let updateCount = 0;
  const database = {
    async $queryRaw() {
      queryCount += 1;
      if (queryCount === 1) {
        return [
          { kind: "leaderboard", id: "7" },
          { kind: "private", id: "11" },
        ];
      }
      return [{
        nextAttemptAt: new Date("2026-02-01T00:00:00.000Z"),
        leaseUntil: new Date("2025-12-31T00:00:00.000Z"),
      }];
    },
    async $executeRaw() {
      updateCount += 1;
      return 1;
    },
  } as unknown as PrismaClient;
  const adapter = createOutboxAdapter({ database, operation: "replay" });
  const page = await adapter.discoverBatch({ cursor: null, limit: 5, scope: "bounded-outbox" });
  assert.deepEqual(page.items.map(({ id }) => id), ["leaderboard:7", "private:11"]);

  const privateResult = await adapter.inspect(page.items[1]!, { asOf: "2026-01-01T00:00:00.000Z" });
  assert.equal(privateResult.skipped, true);
  assert.equal(privateResult.code, "PRIVATE_D1_REPLAY_UNSAFE");

  const leaderboardResult = await adapter.inspect(page.items[0]!, { asOf: "2026-01-01T00:00:00.000Z" });
  assert.equal(leaderboardResult.wouldChange, true);
  const applied = await adapter.apply(page.items[0]!, { asOf: "2026-01-01T00:00:00.000Z" });
  assert.equal(applied.changed, true);
  assert.equal(updateCount, 1);
});

test("outbox compaction reports that terminal retention state is unavailable", async () => {
  const database = {
    async $queryRaw() {
      return [];
    },
    async $executeRaw() {
      assert.fail("Compaction must not delete rows without a retention policy.");
    },
  } as unknown as PrismaClient;
  const adapter = createOutboxAdapter({
    database,
    operation: "compact",
    before: "2026-01-01T00:00:00.000Z",
  });
  const result = await adapter.inspect({ id: "private:1", kind: "private", rowId: "1" }, {
    asOf: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(result.skipped, true);
  assert.equal(result.code, "SAFE_COMPACTION_UNAVAILABLE");
});

test("focus integrity audit summarizes bounded read-only samples", async () => {
  const database = {
    async $queryRaw() {
      return [{
        sampled: 12n,
        invalid_terminal_state: 0n,
        missing_completion_event: 2n,
        mismatched_event_identity: 0n,
      }];
    },
  } as unknown as PrismaClient;
  const report = await runFocusAudit({
    database,
    asOf: "2026-01-01T00:00:00.000Z",
    limit: 12,
  });
  assert.equal(report.status, "WARN");
  assert.equal(report.writeOperationsPerformed, 0);
  assert.equal(report.checks.find(({ name }) => name === "server_validated_completion_evidence")?.count, 2);
});

test("group Focus audit reports invariant counts without exposing participant data", async () => {
  let call = 0;
  const database = {
    async $queryRaw() {
      call += 1;
      return call === 1
        ? [{
          sampled: 3n,
          invalid_runtime: 0n,
          invalid_round_count: 1n,
          missing_summary_event: 0n,
          runs_without_participants: 0n,
        }]
        : [{ invalid_participation: 0n }];
    },
  } as unknown as PrismaClient;
  const report = await runGroupFocusAudit({
    database,
    asOf: "2026-01-01T00:00:00.000Z",
    limit: 10,
  });
  assert.equal(report.status, "WARN");
  assert.equal(report.writeOperationsPerformed, 0);
  assert.equal(report.checks.find(({ name }) => name === "round_count_bounds")?.count, 1);
});