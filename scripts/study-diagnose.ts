import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { collectIncidentDiagnostics } from "../server/observability/diagnostics.js";
import { validateTargetDatabaseUrl } from "../server/observability/releaseGates.js";

type Options = {
  json: boolean;
  target: "local" | "staging";
  output: string | null;
};

function parseArgs(args: string[]): Options {
  const options: Options = { json: false, target: "local", output: null };
  for (const arg of args) {
    if (arg === "--json") options.json = true;
    else if (arg.startsWith("--target=")) {
      const target = arg.slice("--target=".length);
      if (target !== "local" && target !== "staging") {
        throw new Error("Target must be local or staging; production diagnostics are disabled.");
      }
      options.target = target;
    } else if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
    } else {
      throw new Error("Unsupported diagnostic option.");
    }
  }
  return options;
}

function safeOutputPath(value: string): string {
  const base = resolve(process.cwd());
  const destination = resolve(base, value);
  const localPath = relative(base, destination).split("\\").join("/");
  if (
    localPath.startsWith("../")
    || !localPath.startsWith(".local/observability-reports/")
  ) {
    throw new Error("Diagnostic reports must be saved under .local/observability-reports/.");
  }
  return destination;
}

async function main(): Promise<void> {
  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid diagnostic options.");
    process.exitCode = 1;
    return;
  }

  const envKey = options.target === "local"
    ? "STUDY_DIAGNOSTICS_LOCAL_DATABASE_URL"
    : "STUDY_DIAGNOSTICS_STAGING_DATABASE_URL";
  const checkedUrl = validateTargetDatabaseUrl({
    target: options.target,
    value: process.env[envKey],
  });
  if ("reason" in checkedUrl) {
    const report = {
      version: "study-incident-diagnostics-v1",
      mode: "read-only",
      target: options.target,
      generatedAt: new Date().toISOString(),
      status: "UNKNOWN",
      reason: checkedUrl.reason,
      writeOperationsPerformed: 0,
    };
    console.error(options.json ? JSON.stringify(report) : "Diagnostic target configuration was rejected.");
    process.exitCode = 1;
    return;
  }

  let database: PrismaClient | undefined;
  let report: Awaited<ReturnType<typeof collectIncidentDiagnostics>>;
  try {
    if (checkedUrl.value) {
      database = new PrismaClient({
        datasources: { db: { url: checkedUrl.value } },
      });
      await database.$connect();
    }
    report = await collectIncidentDiagnostics({
      target: options.target,
      ...(database ? { database } : {}),
    });
  } catch {
    const fallback = await collectIncidentDiagnostics({ target: options.target });
    report = {
      ...fallback,
      health: {
        ...fallback.health,
        overall: "UNKNOWN",
        freshness: "STALE",
        components: Object.fromEntries(
          Object.entries(fallback.health.components).map(([key, component]) => [
            key,
            { ...component, status: "UNKNOWN", summary: { dataQuality: "DIAGNOSTIC_QUERY_FAILED" } },
          ]),
        ) as unknown as typeof fallback.health.components,
      },
    };
  } finally {
    await database?.$disconnect().catch(() => undefined);
  }

  if (options.output) {
    try {
      const path = safeOutputPath(options.output);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    } catch {
      console.error("Could not save the diagnostic report to the requested local report path.");
      process.exitCode = 1;
      return;
    }
  }

  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Incident diagnostics (${report.target}): ${report.health.overall}`);
    console.log(`Generated: ${report.generatedAt}; mode: read-only`);
    console.log(`Health freshness: ${report.health.freshness}`);
    console.log(`Requests observed in the last ${report.health.operations.windowMinutes} minutes: ${report.health.operations.requests}`);
    if (!database) console.log("Database checks: UNKNOWN (no explicit target database supplied)");
    if (options.output) console.log(`Report saved under: ${relative(process.cwd(), safeOutputPath(options.output))}`);
  }
  process.exitCode = report.health.overall === "UNHEALTHY" ? 1
    : report.health.overall === "UNKNOWN" ? 2
      : 0;
}

void main();