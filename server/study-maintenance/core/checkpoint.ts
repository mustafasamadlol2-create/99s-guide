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
  cursor: string | null;
  scanned: number;
  changed: number;
  wouldChange: number;
  errors: number;
  skipped: number;
}

export async function saveCheckpoint(dir: string, checkpoint: MaintenanceCheckpoint): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${checkpoint.jobId}.json`);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(checkpoint)}\n`, "utf8");
  await rename(temporary, path);
  return path;
}

export async function loadCheckpoint(
  dir: string,
  jobId: string,
  identity: Pick<MaintenanceCheckpoint, "jobType" | "jobVersion" | "mode" | "environment" | "scope">,
): Promise<MaintenanceCheckpoint> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(dir, `${jobId}.json`), "utf8"));
  } catch {
    throw new Error("Maintenance checkpoint is missing or corrupt");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Maintenance checkpoint is corrupt");
  const checkpoint = parsed as Partial<MaintenanceCheckpoint>;
  for (const key of ["jobType", "jobVersion", "mode", "environment", "scope"] as const) {
    if (checkpoint[key] !== identity[key]) throw new Error(`Maintenance checkpoint identity mismatch: ${key}`);
  }
  if (typeof checkpoint.cursor !== "string" && checkpoint.cursor !== null) throw new Error("Maintenance checkpoint cursor is invalid");
  for (const key of ["scanned", "changed", "wouldChange", "errors", "skipped"] as const) {
    if (!Number.isInteger(checkpoint[key]) || (checkpoint[key] as number) < 0) throw new Error("Maintenance checkpoint counters are invalid");
  }
  return checkpoint as MaintenanceCheckpoint;
}