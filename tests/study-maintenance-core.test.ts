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
    mode: "dry-run" as const, scope: "all", all: true, allowCloudflare: false,
    allowExternalWrites: false, asOf: "2026-01-01T00:00:00.000Z",
     batchSize: 2, maxErrors: 0, failOnDrift: false, quiet: true,
     sleepMs: 0, maxRps: 0, ...overrides,
  };
}

test("parser defaults to dry-run and rejects conflicting or unknown options", () => {
  assert.equal(parseMaintenanceArgs(["points", "--environment=test"]).options.mode, "dry-run");
  const compaction = parseMaintenanceArgs([
    "outbox", "compact", "--older-than-days", "30",
  ], { NODE_ENV: "test" });
  assert.equal(compaction.options.mode, "dry-run");
  assert.equal(compaction.options.olderThanDays, 30);
  assert.throws(() => parseMaintenanceArgs(["outbox", "compact", "--older-than-days", "0"], { NODE_ENV: "test" }));
  assert.throws(() => parseMaintenanceArgs(["outbox", "compact", "--older-than-days", "1.5"], { NODE_ENV: "test" }));
  const defaults = parseMaintenanceArgs(["points", "--environment=test"]).options;
  assert.equal(defaults.sleepMs, 0);
  assert.equal(defaults.maxRps, 0);
  assert.equal(parseMaintenanceArgs(["points", "--sleep-ms=25", "--max-rps", "20"], { NODE_ENV: "test" }).options.sleepMs, 25);
  assert.equal(parseMaintenanceArgs(["points", "--sleep-ms=25", "--max-rps", "20"], { NODE_ENV: "test" }).options.maxRps, 20);
  assert.throws(() => parseMaintenanceArgs(["points", "--sleep-ms=-1"], { NODE_ENV: "test" }));
  assert.throws(() => parseMaintenanceArgs(["points", "--sleep-ms=60001"], { NODE_ENV: "test" }));
  assert.throws(() => parseMaintenanceArgs(["points", "--max-rps=-1"], { NODE_ENV: "test" }));
  assert.throws(() => parseMaintenanceArgs(["points", "--max-rps=1001"], { NODE_ENV: "test" }));
  assert.equal(parseMaintenanceArgs(["points", "--apply", "--environment=test"]).options.mode, "apply");
  assert.throws(() => parseMaintenanceArgs(["points", "--apply", "--dry-run"]));
  assert.throws(() => parseMaintenanceArgs(["points", "--unknown"]));
});

test("parser keeps command words while consuming separate option values", () => {
  const parsed = parseMaintenanceArgs([
    "mastery", "rebuild", "--user-id", "user-1", "--batch-size", "25",
  ], { NODE_ENV: "test" });
  assert.equal(parsed.command, "mastery rebuild");
  assert.equal(parsed.options.userId, "user-1");
  assert.equal(parsed.options.batchSize, 25);
  assert.throws(() => parseMaintenanceArgs(["points", "audit", "--as-of", "yesterday"], { NODE_ENV: "test" }));
  assert.throws(
    () => parseMaintenanceArgs(["achievements", "audit", "--user-id", "user-1"], { NODE_ENV: "test" }),
    /fixed --as-of timestamp/u,
  );
  assert.equal(
    parseMaintenanceArgs([
      "achievements", "rebuild", "--user-id", "user-1", "--as-of", "2026-01-01T00:00:00.000Z",
    ], { NODE_ENV: "test" }).options.asOf,
    "2026-01-01T00:00:00.000Z",
  );
  assert.throws(() => parseMaintenanceArgs(["points", "audit", "--environment=test"], {
    NODE_ENV: "production",
    DEPLOYMENT_ENV: "production",
    MAINTENANCE_ENVIRONMENT: "test",
  }));
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
      "mode", "scanned", "scope", "skipped", "startedAt", "status", "statusCounts", "unchanged", "wouldChange",
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
    assert.equal(resumed.jobId, "resume");
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

test("runner rejects unsafe job IDs and production apply before touching the checkpoint store", async () => {
  const calls = { inspect: 0, apply: 0 };
  const dir = await mkdtemp(join(tmpdir(), "study-maintenance-"));
  try {
    await assert.rejects(() => runMaintenance(options(), adapter(["1"], calls), {
      jobId: "../escape",
      checkpointDir: dir,
    }), /job ID is invalid/u);
    await assert.rejects(() => runMaintenance({
      ...options(),
      environment: "production",
      mode: "apply",
    }, adapter(["1"], calls), {
      jobId: "blocked-production",
      checkpointDir: dir,
    }), /Production apply is disabled/u);
    assert.equal(calls.apply, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runner throttles between items but not after the final item", async () => {
  const dir = await mkdtemp(join(tmpdir(), "study-maintenance-"));
  try {
    const started: number[] = [];
    const calls = { inspect: 0, apply: 0 };
    const throttled = adapter(["1", "2", "3"], calls);
    const wrapped: MaintenanceAdapter = {
      ...throttled,
      async inspect(item, input) {
        started.push(Date.now());
        return throttled.inspect(item, input);
      },
    };
    const before = Date.now();
    await runMaintenance({ ...options(), sleepMs: 15 }, wrapped, { jobId: "throttle", checkpointDir: dir });
    const elapsed = Date.now() - before;
    assert.ok(started[1]! - started[0]! >= 10);
    assert.ok(started[2]! - started[1]! >= 10);
    assert.ok(elapsed < 60);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SIGTERM pauses with a checkpoint and resumes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "study-maintenance-"));
  try {
    const calls = { inspect: 0, apply: 0 };
    let signalled = false;
    const first = adapter(["1", "2", "3"], calls);
    const interrupting: MaintenanceAdapter = {
      ...first,
      async inspect(item, input) {
        const result = await first.inspect(item, input);
        if (!signalled) {
          signalled = true;
          process.emit("SIGTERM");
        }
        return result;
      },
    };
    const paused = await runMaintenance(options(), interrupting, { jobId: "signal", checkpointDir: dir });
    assert.equal(paused.status, "PAUSED");
    assert.equal(paused.scanned, 1);
    const resumed = await runMaintenance({ ...options(), resumeJobId: "signal" }, first, {
      jobId: "different-id", checkpointDir: dir,
    });
    assert.equal(resumed.status, "COMPLETED");
    assert.equal(resumed.scanned, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scope lock rejects same target across job IDs but permits unrelated scopes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "study-maintenance-"));
  try {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const blocking: MaintenanceAdapter = {
      async discoverBatch() {
        await held;
        return { items: [], nextCursor: null };
      },
      async inspect() { return { status: "OK" }; },
      async apply() { return { status: "OK" }; },
    };
    const first = runMaintenance(options({ scope: "user-1" }), blocking, { jobId: "one", checkpointDir: dir });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await assert.rejects(runMaintenance(options({ scope: "user-1" }), blocking, { jobId: "two", checkpointDir: dir }), /already running/u);
    const other = runMaintenance(options({ scope: "user-2" }), blocking, { jobId: "three", checkpointDir: dir });
    release!();
    await Promise.all([first, other]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});