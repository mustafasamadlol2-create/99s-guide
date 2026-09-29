import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { loadCheckpoint, saveCheckpoint, type MaintenanceCheckpoint } from "./checkpoint";
import { writeMaintenanceReport } from "./report";
import type {
  MaintenanceAdapter,
  MaintenanceReport,
  MaintenanceRunOptions,
  InspectionResult,
} from "./types";

function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof Error && error.message.startsWith("MAINTENANCE_SAFE:")) {
    return { code: "adapter_error", message: error.message.slice("MAINTENANCE_SAFE:".length).trim().slice(0, 200) };
  }
  return { code: "maintenance_error", message: "Maintenance item could not be processed safely." };
}

export async function runMaintenance<T extends { id: string }>(
  options: MaintenanceRunOptions,
  adapter: MaintenanceAdapter<T>,
  input: { jobId?: string; now?: Date; checkpointDir?: string } = {},
): Promise<MaintenanceReport> {
  const jobId = options.resumeJobId ?? input.jobId ?? randomUUID();
  if (!/^[a-zA-Z0-9_-]{1,100}$/u.test(jobId)) {
    throw new Error("Maintenance job ID is invalid");
  }
  if (options.environment === "production" && options.mode === "apply") {
    throw new Error("Production apply is disabled while maintenance checkpoints are local-only");
  }
  const now = input.now ?? new Date();
  const checkpointDir = input.checkpointDir ?? options.checkpointDir ?? join("reports", "study-maintenance", "checkpoints");
  const identity = { jobType: options.jobType, jobVersion: options.jobVersion, mode: options.mode, environment: options.environment, scope: options.scope };
  await mkdir(checkpointDir, { recursive: true });
  // Checkpoints remain job-ID keyed so an interrupted run can be resumed
  // explicitly. The active lock is target keyed so two job IDs cannot mutate
  // the same target concurrently while unrelated scopes remain independent.
  const lockKey = [options.jobType, options.jobVersion, options.scope].join("\0");
  const lockFingerprint = createHash("sha256").update(lockKey).digest("hex");
  const lockPath = join(checkpointDir, `${lockFingerprint}.lock`);
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch {
    throw new Error("Maintenance job is already running or its lock needs operator review");
  }
  let checkpoint: MaintenanceCheckpoint = {
    jobId,
    ...identity,
    status: "RUNNING",
    startedAt: now.toISOString(),
    cursor: options.afterId ?? null,
    scanned: 0,
    unchanged: 0,
    changed: 0,
    wouldChange: 0,
    errors: 0,
    skipped: 0,
    statusCounts: {},
  };
  if (options.resumeJobId) {
    try {
      checkpoint = await loadCheckpoint(checkpointDir, options.resumeJobId, identity);
      if (checkpoint.status === "COMPLETED") {
        throw new Error("A completed maintenance job cannot be resumed");
      }
      checkpoint.status = "RUNNING";
    } catch (error) {
      await lock.close();
      await unlink(lockPath).catch(() => undefined);
      throw error;
    }
  }
  const started = new Date(checkpoint.startedAt);
  const errorDetails: MaintenanceReport["errorDetails"] = [];
  let cursor = checkpoint.cursor;
  let interrupted = false;
  const onSignal = () => { interrupted = true; };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  let lastProcessedAt: number | null = null;
  const intervalMs = options.maxRps && options.maxRps > 0 ? 1000 / options.maxRps : 0;
  const throttle = async (): Promise<void> => {
    if (lastProcessedAt === null) return;
    const nowMs = Date.now();
    const waitMs = Math.max(options.sleepMs, intervalMs) - (nowMs - lastProcessedAt);
    if (waitMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
  };
  try {
    while (!interrupted && (options.limit === undefined || checkpoint.scanned < options.limit)) {
      const remaining = options.limit === undefined ? options.batchSize : Math.min(options.batchSize, options.limit - checkpoint.scanned);
      const page = await adapter.discoverBatch({ cursor, limit: remaining, scope: options.scope });
      if (page.items.length === 0) {
        checkpoint.status = "COMPLETED";
        checkpoint.cursor = cursor;
        await saveCheckpoint(checkpointDir, checkpoint);
        break;
      }
      let lastProcessedCursor = cursor;
      for (const item of page.items) {
        if (interrupted) break;
        await throttle();
        if (interrupted) break;
        try {
          const result: InspectionResult = options.mode === "apply"
            ? await adapter.apply(item, { asOf: options.asOf })
            : await adapter.inspect(item, { asOf: options.asOf });
          checkpoint.scanned += 1;
          const status = /^[A-Z0-9_-]{1,80}$/u.test(result.status) ? result.status : "UNKNOWN";
          checkpoint.statusCounts[status] = (checkpoint.statusCounts[status] ?? 0) + 1;
          if (result.skipped) checkpoint.skipped += 1;
          else if (result.changed) checkpoint.changed += 1;
          else if (result.wouldChange) checkpoint.wouldChange += 1;
          else checkpoint.unchanged += 1;
          lastProcessedCursor = item.id;
          lastProcessedAt = Date.now();
        } catch (error) {
          checkpoint.scanned += 1;
          checkpoint.errors += 1;
          checkpoint.statusCounts.ERROR = (checkpoint.statusCounts.ERROR ?? 0) + 1;
          lastProcessedCursor = item.id;
          const detail = safeError(error);
          errorDetails.push({ ...detail, itemId: item.id });
          if (options.maxErrors === 0 || checkpoint.errors >= options.maxErrors) {
            checkpoint.cursor = lastProcessedCursor;
            await saveCheckpoint(checkpointDir, checkpoint);
            throw new Error(`Maintenance stopped after ${checkpoint.errors} error(s)`, {
              cause: error,
            });
          }
          lastProcessedAt = Date.now();
        }
      }
      const pageWasFullyProcessed = lastProcessedCursor === page.items.at(-1)?.id;
      cursor = pageWasFullyProcessed ? page.nextCursor ?? lastProcessedCursor : lastProcessedCursor;
      checkpoint.cursor = cursor;
      const limitReached = options.limit !== undefined && checkpoint.scanned >= options.limit;
      checkpoint.status = interrupted || limitReached ? "PAUSED" : "RUNNING";
      await saveCheckpoint(checkpointDir, checkpoint);
      if (interrupted || limitReached) break;
      if (page.nextCursor === null) {
        checkpoint.status = "COMPLETED";
        await saveCheckpoint(checkpointDir, checkpoint);
        break;
      }
    }
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    await lock.close();
    await unlink(lockPath).catch(() => undefined);
  }
  if (checkpoint.status === "RUNNING") {
    checkpoint.status = "PAUSED";
    await saveCheckpoint(checkpointDir, checkpoint);
  }
  const ended = new Date();
  const report: MaintenanceReport = {
    jobId, ...identity, status: checkpoint.status, asOf: options.asOf, startedAt: started.toISOString(), endedAt: ended.toISOString(),
    durationMs: ended.getTime() - started.getTime(), scanned: checkpoint.scanned, unchanged: checkpoint.unchanged,
    changed: checkpoint.changed, wouldChange: checkpoint.wouldChange, errors: checkpoint.errors,
    skipped: checkpoint.skipped, checkpoint: join(checkpointDir, `${jobId}.json`),
    statusCounts: { ...checkpoint.statusCounts }, errorDetails,
  };
  if (options.reportFile) await writeMaintenanceReport(options.reportFile, report);
  if (options.failOnDrift && options.mode === "dry-run" && report.wouldChange > 0) {
    throw new Error("Maintenance drift detected");
  }
  return report;
}