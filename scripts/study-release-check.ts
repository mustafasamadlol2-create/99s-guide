import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { getStudyFeatureFlags } from "../server/features/study-core/featureFlags.js";
import {
  buildReleaseReport,
  inspectReleaseDatabase,
  releaseGate,
  summarizeReleaseReport,
  validateFeatureConfiguration,
  validateTargetDatabaseUrl,
} from "../server/observability/releaseGates.js";
import { loadStudyReleaseProfile } from "../server/observability/releaseProfile.js";
import type { ReleaseGateResult } from "../server/observability/types.js";

type Options = {
  json: boolean;
  target: "local" | "staging";
  mode: "fast" | "deep";
  profilePath: string | null;
  reportPath: string | null;
};

function parseArgs(args: string[]): Options {
  const options: Options = {
    json: false,
    target: "local",
    mode: "fast",
    profilePath: null,
    reportPath: null,
  };
  for (const arg of args) {
    if (arg === "--json") options.json = true;
    else if (arg === "--fast") options.mode = "fast";
    else if (arg === "--deep") options.mode = "deep";
    else if (arg.startsWith("--target=")) {
      const target = arg.slice("--target=".length);
      if (target !== "local" && target !== "staging") {
        throw new Error("Target must be local or staging; production checks are disabled.");
      }
      options.target = target;
    } else if (arg.startsWith("--profile=")) {
      options.profilePath = arg.slice("--profile=".length);
    } else if (arg.startsWith("--report=")) {
      options.reportPath = arg.slice("--report=".length);
    } else {
      throw new Error("Unsupported release-check option.");
    }
  }
  return options;
}

function safeReportPath(value: string): string {
  const base = resolve(process.cwd());
  const destination = resolve(base, value);
  const localPath = relative(base, destination).split("\\").join("/");
  if (
    localPath.startsWith("../")
    || !localPath.startsWith(".local/observability-reports/")
  ) {
    throw new Error("Release reports must be saved under .local/observability-reports/.");
  }
  return destination;
}

function childEnvironment(forTests: boolean): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (
      /DATABASE_URL$/iu.test(name)
      || /^PG(?:HOST|PORT|USER|PASSWORD|DATABASE|SSLMODE)/iu.test(name)
      || name === "SUPABASE_DATABASE_URL"
      || name === "DIRECT_URL"
      || /SECRET|TOKEN|PASSWORD|CREDENTIAL|API_KEY/iu.test(name)
    ) {
      environment[name] = "";
    }
  }
  // These loopback-only placeholders keep any accidentally ungated integration
  // test away from all configured databases while allowing Prisma schema work.
  environment.DATABASE_URL = "postgresql://release_check:local_only@127.0.0.1:1/release_check";
  environment.DIRECT_URL = environment.DATABASE_URL;
  environment.SUPABASE_DATABASE_URL = "";
  environment.TEST_DATABASE_URL = "";
  environment.POSTGRES_TEST_URL = "";
  if (forTests) environment.NODE_ENV = "test";
  return environment;
}

function runCommandGate(input: {
  gate: string;
  code: string;
  command: string;
  args: string[];
  forTests?: boolean;
}): ReleaseGateResult {
  const result = spawnSync(input.command, input.args, {
    cwd: process.cwd(),
    env: childEnvironment(Boolean(input.forTests)),
    stdio: "ignore",
    timeout: 5 * 60_000,
    windowsHide: true,
  });
  const passed = result.status === 0 && !result.error;
  return releaseGate(
    input.gate,
    passed ? "PASS" : "FAIL",
    passed ? `${input.code}_PASS` : `${input.code}_FAILED`,
    passed
      ? `${input.gate} completed successfully.`
      : `${input.gate} failed; rerun the corresponding local command to inspect details.`,
  );
}

async function databaseGates(
  target: "local" | "staging",
  mode: "fast" | "deep",
): Promise<ReleaseGateResult[]> {
  const key = target === "local"
    ? "STUDY_RELEASE_LOCAL_DATABASE_URL"
    : "STUDY_RELEASE_STAGING_DATABASE_URL";
  const checked = validateTargetDatabaseUrl({
    target,
    value: process.env[key],
  });
  if ("reason" in checked) {
    return [
      releaseGate("postgres_connectivity", "FAIL", checked.reason, "The explicit target database was rejected."),
      releaseGate("schema_compatibility", "FAIL", "DATABASE_TARGET_REJECTED", "Schema compatibility was not checked."),
      releaseGate("migration_status", "FAIL", "DATABASE_TARGET_REJECTED", "Migration status was not checked."),
      releaseGate("projection_outbox", "FAIL", "DATABASE_TARGET_REJECTED", "Outbox status was not checked."),
      releaseGate("ledger_invariant", "SKIP", "DATABASE_TARGET_REJECTED", "Ledger audit was skipped."),
      releaseGate("projection_drift", "SKIP", "DATABASE_TARGET_REJECTED", "Projection audit was skipped."),
    ];
  }
  if (!checked.value) {
    return [
      releaseGate("postgres_connectivity", "SKIP", "TARGET_DATABASE_NOT_CONFIGURED", "No explicit local/staging database URL was supplied."),
      releaseGate("schema_compatibility", "WARN", "SCHEMA_NOT_CHECKED", "Schema compatibility requires an explicit target database."),
      releaseGate("migration_status", "WARN", "MIGRATION_STATUS_NOT_CHECKED", "Migration status requires an explicit target database."),
      releaseGate("projection_outbox", "WARN", "OUTBOX_NOT_CHECKED", "Projection outbox status requires an explicit target database."),
      releaseGate("ledger_invariant", "WARN", "LEDGER_AUDIT_NOT_CHECKED", "No privacy-safe ledger audit summary is available."),
      releaseGate("projection_drift", "WARN", "PROJECTION_AUDIT_NOT_CHECKED", "No privacy-safe projection audit summary is available."),
    ];
  }

  const database = new PrismaClient({
    datasources: { db: { url: checked.value } },
  });
  try {
    await database.$connect();
    const maxPendingText = process.env.STUDY_RELEASE_MAX_PENDING_OUTBOX;
    const maxPending = maxPendingText === undefined
      ? undefined
      : /^\d+$/u.test(maxPendingText) ? Number(maxPendingText) : Number.NaN;
    if (maxPending !== undefined && !Number.isSafeInteger(maxPending)) {
      return [
        ...await inspectReleaseDatabase(database),
        releaseGate(
          "outbox_threshold_config",
          "FAIL",
          "INVALID_OUTBOX_THRESHOLD",
          "STUDY_RELEASE_MAX_PENDING_OUTBOX must be a non-negative integer.",
        ),
      ];
    }
    return inspectReleaseDatabase(database, {
      maxPending,
      runCohortAudits: mode === "deep"
        && /^(1|true|yes|on)$/iu.test(process.env.STUDY_RELEASE_ALLOW_COHORT_AUDIT ?? ""),
    });
  } catch {
    return inspectReleaseDatabase(database);
  } finally {
    await database.$disconnect().catch(() => undefined);
  }
}

function featureDependencyGates(
  flags: Readonly<Record<string, boolean>>,
  environment: Readonly<Record<string, string | undefined>>,
): ReleaseGateResult[] {
  const gates: ReleaseGateResult[] = [];
  const groupWorkerUrl = environment.GROUP_FOCUS_WORKER_URL
    || environment.VITE_GROUP_FOCUS_WORKER_URL;
  gates.push(flags.GROUP_FOCUS_ENABLED
    ? groupWorkerUrl
      ? releaseGate("group_runtime_config", "WARN", "GROUP_RUNTIME_NOT_PROBED", "Group Focus is enabled; worker configuration exists but runtime reachability was not probed.")
      : releaseGate("group_runtime_config", "FAIL", "GROUP_RUNTIME_CONFIG_MISSING", "Group Focus is enabled but its Worker URL is not configured.")
    : releaseGate("group_runtime_config", "SKIP", "GROUP_FOCUS_DISABLED", "Group Focus is disabled in the intended profile."));

  gates.push(flags.AI_STUDY_INSIGHTS_ENABLED
    ? releaseGate("ai_provider", "WARN", "AI_PROVIDER_NOT_PROBED", "AI Insights is enabled; provider reachability is not probed by this local release check.")
    : releaseGate("ai_provider", "SKIP", "AI_INSIGHTS_DISABLED", "AI Insights is disabled in the intended profile."));

  const d1Enabled =
    flags.LEADERBOARD_D1_PROJECTION_ENABLED || flags.LEADERBOARD_D1_READ_ENABLED;
  gates.push(d1Enabled
    ? releaseGate("d1_dependency", "WARN", "D1_RUNTIME_NOT_PROBED", "D1 projection is enabled; runtime reachability is not probed by this command.")
    : releaseGate("d1_dependency", "SKIP", "D1_DISABLED", "D1 projections are disabled in the intended profile."));

  return gates;
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  let options: Options;
  try {
    options = parseArgs(rawArgs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid release-check options.";
    console.error(rawArgs.includes("--json")
      ? JSON.stringify({ version: "study-release-check-v1", status: "NOT_READY", error: message, writeOperationsPerformed: 0 })
      : message);
    process.exitCode = 1;
    return;
  }

  const startedAt = new Date().toISOString();
  const gates: ReleaseGateResult[] = [];
  let profile;
  try {
    profile = await loadStudyReleaseProfile(options.profilePath ?? undefined);
  } catch {
    gates.push(releaseGate(
      "release_profile",
      "FAIL",
      "RELEASE_PROFILE_INVALID",
      "The selected release profile could not be loaded or contains unsupported fields.",
    ));
    profile = { name: "invalid-profile", flags: getStudyFeatureFlags(), source: "environment" as const };
  }

  const flags = profile.flags;
  gates.push(validateFeatureConfiguration(flags, process.env));
  gates.push(releaseGate(
    "required_secrets",
    process.env.SESSION_SECRET || process.env.JWT_SECRET ? "PASS" : "FAIL",
    process.env.SESSION_SECRET || process.env.JWT_SECRET ? "AUTH_SECRET_PRESENT" : "AUTH_SECRET_NOT_CONFIGURED",
    process.env.SESSION_SECRET || process.env.JWT_SECRET
      ? "Authentication secret presence was confirmed; no value was read into the report."
      : "Authentication secret presence was not confirmed in this environment.",
  ));
  gates.push(...featureDependencyGates(flags, process.env));

  const commandGates = [
    runCommandGate({ gate: "build", code: "BUILD", command: "npm", args: ["run", "build"] }),
    runCommandGate({ gate: "typecheck", code: "TYPECHECK", command: "npm", args: ["run", "typecheck"] }),
    runCommandGate({ gate: "lint", code: "LINT", command: "npm", args: ["run", "lint"] }),
    runCommandGate({
      gate: "study_engine_tests",
      code: "STUDY_ENGINE_TESTS",
      command: "npm",
      args: ["run", "test:study-engine"],
      forTests: true,
    }),
    runCommandGate({
      gate: "maintenance_tests",
      code: "MAINTENANCE_TESTS",
      command: "npm",
      args: ["run", "test:study-maintenance"],
      forTests: true,
    }),
    runCommandGate({
      gate: "observability_tests",
      code: "OBSERVABILITY_TESTS",
      command: "npm",
      args: ["run", "test:study-observability"],
      forTests: true,
    }),
    runCommandGate({
      gate: "owner_privacy_tests",
      code: "OWNER_PRIVACY_TESTS",
      command: "npm",
      args: ["run", "test:owner-analytics-frontend"],
      forTests: true,
    }),
  ];
  gates.push(...commandGates);

  const testStatus = commandGates.every((gate) => gate.status === "PASS") ? "PASS" : "FAIL";
  for (const [gate, code, message] of [
    ["privacy_invariants", "PRIVACY", "Privacy regression tests are included in the targeted suites."],
    ["concurrency", "CONCURRENCY", "Concurrency regression tests are included in the Study Engine suite."],
    ["calendar_isolation", "CALENDAR", "Calendar isolation regression tests are included in the Study Engine suite."],
    ["points_idempotency", "POINTS_IDEMPOTENCY", "Study Points idempotency tests are included in the Study Engine suite."],
    ["recall_authority", "RECALL_AUTHORITY", "Recall authority tests are included in the Study Engine suite."],
    ["mastery_retention_invariants", "MASTERY_RETENTION", "Mastery and Retention invariant tests are included in the Study Engine suite."],
  ] as const) {
    gates.push(releaseGate(gate, testStatus, `${code}_${testStatus}`, message));
  }

  const prismaEnv = childEnvironment(false);
  prismaEnv.DATABASE_URL = "postgresql://release_check:local_only@127.0.0.1:1/release_check";
  prismaEnv.DIRECT_URL = prismaEnv.DATABASE_URL;
  const prismaValidation = spawnSync("npx", ["prisma", "validate"], {
    cwd: process.cwd(),
    env: prismaEnv,
    stdio: "ignore",
    timeout: 60_000,
    windowsHide: true,
  });
  const prismaValid = prismaValidation.status === 0 && !prismaValidation.error;
  gates.push(releaseGate(
    "prisma_schema",
    prismaValid ? "PASS" : "FAIL",
    prismaValid ? "PRISMA_SCHEMA_VALID" : "PRISMA_SCHEMA_INVALID",
    prismaValid
      ? "Prisma schema validation passed without contacting a database."
      : "Prisma schema validation failed.",
  ));

  if (options.mode === "deep") {
    gates.push(runCommandGate({
      gate: "group_worker_typecheck",
      code: "GROUP_WORKER_TYPECHECK",
      command: "npm",
      args: ["run", "worker:group-focus:typecheck"],
    }));
  }

  gates.push(...await databaseGates(options.target, options.mode));
  gates.push(releaseGate(
    "maintenance_readiness",
    existsSync(resolve("server/study-maintenance/cli/main.ts"))
      ? "PASS"
      : "FAIL",
    existsSync(resolve("server/study-maintenance/cli/main.ts"))
      ? "READ_ONLY_MAINTENANCE_CLI_PRESENT"
      : "MAINTENANCE_CLI_MISSING",
    existsSync(resolve("server/study-maintenance/cli/main.ts"))
      ? "Existing operator-controlled maintenance CLI is available; this check performs no maintenance action."
      : "The existing maintenance CLI could not be found.",
  ));
  gates.push(releaseGate(
    "read_only_policy",
    "PASS",
    "NO_MUTATING_COMMANDS",
    "No deploy, repair, rebuild, backfill, migration, or flag mutation command was invoked.",
  ));

  const report = buildReleaseReport({
    target: options.target,
    mode: options.mode,
    gates,
    checkedAt: startedAt,
  });
  if (options.reportPath) {
    try {
      const path = safeReportPath(options.reportPath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify({ ...report, profile: profile.name }, null, 2)}\n`, { mode: 0o600 });
    } catch {
      console.error("Could not save the release report to the requested local report path.");
      process.exitCode = 1;
      return;
    }
  }

  if (options.json) console.log(JSON.stringify({ ...report, profile: profile.name }, null, 2));
  else {
    console.log(summarizeReleaseReport(report));
    console.log(`Profile: ${profile.name} (${profile.source}); writes: 0; automatic deployment: disabled.`);
    if (options.reportPath) {
      console.log(`Report saved under: ${relative(process.cwd(), safeReportPath(options.reportPath))}`);
    }
  }
  process.exitCode = report.status === "NOT_READY" ? 1
    : report.status === "READY_WITH_WARNINGS" ? 2
      : 0;
}

void main();