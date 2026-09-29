import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  PRODUCTION_CONFIRMATION,
  loadCheckpoint,
  parseMaintenanceArgs,
  runMaintenance,
  type MaintenanceAdapter,
} from "../server/study-maintenance/core/index";

function adapter(ids: string[], calls: { inspect: number; apply: number }): MaintenanceAdapter {
  return {
    async discoverBatch({ cursor, limit }) {
      const start = cursor ? ids.indexOf(cursor) + 1 : 0;
      const items = ids.slice(start, start + limit).map((id) => ({ id }));
      return { items, nextCursor: items.at(-1)?.id ?? null };
    },
    async inspect(item) {
      calls.inspect += 1;
      return { status: "DRIFT", wouldChange: item.id === "2" };
    },
    async apply(item) {
      calls.apply += 1;
      return { status: "REPAIRED", changed: item.id === "2" };
    },
  };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    jobType: "points-rebuild", jobVersion: "1", environment: "test" as const,
    mode: "dry-run" as const, scope: "all", asOf: "2026-01-01T00:00:00.000Z",
    batchSize: 2, maxErrors: 0, failOnDrift: false, quiet: true, ...overrides,
  };
}

test("parser defaults to dry-run and rejects conflicting or unknown options", () => {
  assert.equal(parseMaintenanceArgs(["points", "--environment=test"]).options.mode, "dry-run");
  assert.equal(parseMaintenanceArgs(["points", "--apply", "--environment=test"]).options.mode, "apply");
  assert.throws(() => parseMaintenanceArgs(["points", "--apply", "--dry-run"]));
  assert.throws(() => parseMaintenanceArgs(["points", "--unknown"]));
});

test("production apply requires the fixed confirmation", () => {
  assert.throws(() => parseMaintenanceArgs(["points", "--apply", "--environment=production"]));
  const parsed = parseMaintenanceArgs([
    "points", "--apply", "--environment=production", `--confirm-production=${PRODUCTION_CONFIRMATION}`,
  ]);
  assert.equal(parsed.options.environment, "production");
});

test("dry-run never calls apply and reports bounded paging", async () => {
  const calls = { inspect: 0, apply: 0 };
  const dir = await mkdtemp(join(tmpdir(), "study-maintenance-"));
  try {
    const report = await runMaintenance(options(), adapter(["1", "2", "3", "4", "5"], calls), {
      jobId: "dry-run", checkpointDir: dir,
    });
    assert.equal(calls.apply, 0);
    assert.equal(calls.inspect, 5);
    assert.equal(report.scanned, 5);
    assert.equal(report.wouldChange, 1);
    assert.equal(report.checkpoint, join(dir, "dry-run.json"));
    const checkpoint = JSON.parse(await readFile(join(dir, "dry-run.json"), "utf8"));
    assert.deepEqual(Object.keys(checkpoint).sort(), [
      "changed", "cursor", "environment", "errors", "jobId", "jobType", "jobVersion",
      "mode", "scanned", "scope", "skipped", "wouldChange",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("apply calls only apply and resumes from a validated checkpoint", async () => {
  const dir = await mkdtemp(join(tmpdir(), "study-maintenance-"));
  try {
    const calls = { inspect: 0, apply: 0 };
    const first = await runMaintenance({ ...options(), mode: "apply", limit: 2 }, adapter(["1", "2", "3"], calls), {
      jobId: "resume", checkpointDir: dir,
    });
    assert.equal(first.scanned, 2);
    assert.equal(calls.inspect, 0);
    assert.equal(calls.apply, 2);
    const resumed = await runMaintenance({ ...options(), mode: "apply", resumeJobId: "resume" }, adapter(["1", "2", "3"], calls), {
      jobId: "resumed", checkpointDir: dir,
    });
    assert.equal(resumed.scanned, 3);
    assert.equal(calls.apply, 3);
    await assert.rejects(() => loadCheckpoint(dir, "resume", {
      jobType: "other", jobVersion: "1", mode: "apply", environment: "test", scope: "all",
    }));
    await rm(join(dir, "resume.json"), { force: true });
    await assert.rejects(() => loadCheckpoint(dir, "resume", {
      jobType: "points-rebuild", jobVersion: "1", mode: "apply", environment: "test", scope: "all",
    }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});