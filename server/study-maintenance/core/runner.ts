import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
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
  const jobId = input.jobId ?? randomUUID();
  const started = input.now ?? new Date();
  const checkpointDir = input.checkpointDir ?? options.checkpointDir ?? join("reports", "study-maintenance", "checkpoints");
  const identity = { jobType: options.jobType, jobVersion: options.jobVersion, mode: options.mode, environment: options.environment, scope: options.scope };
  let checkpoint: MaintenanceCheckpoint = {
    jobId, ...identity, cursor: options.afterId ?? null, scanned: 0, changed: 0, wouldChange: 0, errors: 0, skipped: 0,
  };
  if (options.resumeJobId) checkpoint = await loadCheckpoint(checkpointDir, options.resumeJobId, identity);
  const errorDetails: MaintenanceReport["errorDetails"] = [];
  let unchanged = 0;
  let cursor = checkpoint.cursor;
  let interrupted = false;
  const onSignal = () => { interrupted = true; };
  process.once("SIGINT", onSignal);
  try {
    while (!interrupted && (options.limit === undefined || checkpoint.scanned < options.limit)) {
      const remaining = options.limit === undefined ? options.batchSize : Math.min(options.batchSize, options.limit - checkpoint.scanned);
      const page = await adapter.discoverBatch({ cursor, limit: remaining, scope: options.scope });
      if (page.items.length === 0) break;
      for (const item of page.items) {
        if (interrupted) break;
        try {
          const result: InspectionResult = options.mode === "apply"
            ? await adapter.apply(item, { asOf: options.asOf })
            : await adapter.inspect(item, { asOf: options.asOf });
          checkpoint.scanned += 1;
          if (result.skipped) checkpoint.skipped += 1;
          else if (result.changed) checkpoint.changed += 1;
          else if (result.wouldChange) checkpoint.wouldChange += 1;
          else unchanged += 1;
        } catch (error) {
          checkpoint.scanned += 1;
          checkpoint.errors += 1;
          const detail = safeError(error);
          errorDetails.push({ ...detail, itemId: item.id });
          if (options.maxErrors === 0 || checkpoint.errors >= options.maxErrors) {
            await saveCheckpoint(checkpointDir, checkpoint);
            throw new Error(`Maintenance stopped after ${checkpoint.errors} error(s)`, {
              cause: error,
            });
          }
        }
      }
      cursor = page.nextCursor;
      checkpoint.cursor = cursor;
      await saveCheckpoint(checkpointDir, checkpoint);
      if (!cursor) break;
    }
  } finally {
    process.removeListener("SIGINT", onSignal);
  }
  const ended = new Date();
  const report: MaintenanceReport = {
    jobId, ...identity, asOf: options.asOf, startedAt: started.toISOString(), endedAt: ended.toISOString(),
    durationMs: ended.getTime() - started.getTime(), scanned: checkpoint.scanned, unchanged,
    changed: checkpoint.changed, wouldChange: checkpoint.wouldChange, errors: checkpoint.errors,
    skipped: checkpoint.skipped, checkpoint: join(checkpointDir, `${jobId}.json`), errorDetails,
  };
  if (options.reportFile) await writeMaintenanceReport(options.reportFile, report);
  if (options.failOnDrift && options.mode === "dry-run" && report.wouldChange > 0) {
    throw new Error("Maintenance drift detected");
  }
  await mkdir(checkpointDir, { recursive: true });
  return report;
}