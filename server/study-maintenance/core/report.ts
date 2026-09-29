import { writeFile } from "node:fs/promises";
import type { MaintenanceReport } from "./types";

export async function writeMaintenanceReport(path: string, report: MaintenanceReport): Promise<void> {
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}