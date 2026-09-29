import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MaintenanceRunOptions } from "./types";

export interface MaintenanceCheckpoint {
  jobId: string;
  jobType: string;
  jobVersion: string;
  mode: MaintenanceRunOptions["mode"];
  environment: MaintenanceRunOptions["environment"];
  scope: string;
  status: "RUNNING" | "PAUSED" | "COMPLETED";
  startedAt: string;
  cursor: string | null;
  scanned: number;
  unchanged: number;
  changed: number;
  wouldChange: number;
  errors: number;
  skipped: number;
  statusCounts: Record<string, number>;
}

function assertSafeJobId(jobId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,100}$/u.test(jobId)) {
    throw new Error("Maintenance job ID is invalid");
  }
}

export async function saveCheckpoint(dir: string, checkpoint: MaintenanceCheckpoint): Promise<string> {
  assertSafeJobId(checkpoint.jobId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${checkpoint.jobId}.json`);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(checkpoint)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
  return path;
}

export async function loadCheckpoint(
  dir: string,
  jobId: string,
  identity: Pick<MaintenanceCheckpoint, "jobType" | "jobVersion" | "mode" | "environment" | "scope">,
): Promise<MaintenanceCheckpoint> {
  assertSafeJobId(jobId);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(dir, `${jobId}.json`), "utf8"));
  } catch {
    throw new Error("Maintenance checkpoint is missing or corrupt");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Maintenance checkpoint is corrupt");
  const checkpoint = parsed as Partial<MaintenanceCheckpoint>;
  if (checkpoint.jobId !== jobId) throw new Error("Maintenance checkpoint job ID mismatch");
  for (const key of ["jobType", "jobVersion", "mode", "environment", "scope"] as const) {
    if (checkpoint[key] !== identity[key]) throw new Error(`Maintenance checkpoint identity mismatch: ${key}`);
  }
  if (checkpoint.status !== "PAUSED" && checkpoint.status !== "RUNNING" && checkpoint.status !== "COMPLETED") {
    throw new Error("Maintenance checkpoint status is invalid");
  }
  if (typeof checkpoint.startedAt !== "string" || Number.isNaN(Date.parse(checkpoint.startedAt))) {
    throw new Error("Maintenance checkpoint start time is invalid");
  }
  if (typeof checkpoint.cursor !== "string" && checkpoint.cursor !== null) throw new Error("Maintenance checkpoint cursor is invalid");
  for (const key of ["scanned", "unchanged", "changed", "wouldChange", "errors", "skipped"] as const) {
    if (!Number.isInteger(checkpoint[key]) || (checkpoint[key] as number) < 0) throw new Error("Maintenance checkpoint counters are invalid");
  }
  if (!checkpoint.statusCounts || typeof checkpoint.statusCounts !== "object" || Array.isArray(checkpoint.statusCounts)) {
    throw new Error("Maintenance checkpoint status counts are invalid");
  }
  for (const [status, count] of Object.entries(checkpoint.statusCounts)) {
    if (!/^[A-Z0-9_-]{1,80}$/u.test(status) || !Number.isInteger(count) || count < 0) {
      throw new Error("Maintenance checkpoint status counts are invalid");
    }
  }
  return checkpoint as MaintenanceCheckpoint;
}