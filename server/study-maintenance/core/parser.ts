import type {
  MaintenanceArgs,
  MaintenanceEnvironment,
  MaintenanceRunOptions,
} from "./types";

export const PRODUCTION_CONFIRMATION = "APPLY_STUDY_MAINTENANCE_TO_PRODUCTION";

const environments = new Set<MaintenanceEnvironment>([
  "local",
  "development",
  "test",
  "staging",
  "production",
]);

const valueOptions = new Set([
  "--environment",
  "--confirm-production",
  "--job-version",
  "--scope",
  "--user-id",
  "--lecture-id",
  "--season-id",
  "--snapshot-id",
  "--before",
  "--as-of",
  "--batch-size",
  "--limit",
  "--max-errors",
  "--resume-job",
  "--after-id",
  "--report-file",
  "--checkpoint-dir",
]);

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;

function value(args: string[], index: number, name: string): string {
  const argument = args[index];
  const inline = argument.slice(name.length + 1);
  if (inline) return inline;
  const next = args[index + 1];
  if (!next || next.startsWith("--")) throw new Error(`${name} requires a value`);
  return next;
}

export function detectEnvironment(env: NodeJS.ProcessEnv = process.env): MaintenanceEnvironment {
  const deploymentMarker = env.REPLIT_DEPLOYMENT;
  const productionRuntime = env.NODE_ENV === "production"
    || env.DEPLOYMENT_ENV === "production"
    || (deploymentMarker !== undefined && deploymentMarker !== "" && deploymentMarker !== "false");
  const raw = productionRuntime
    ? "production"
    : env.MAINTENANCE_ENVIRONMENT ?? env.DEPLOYMENT_ENV ?? env.NODE_ENV ?? "development";
  if (!environments.has(raw as MaintenanceEnvironment)) {
    throw new Error(`Unsupported maintenance environment: ${raw}`);
  }
  return raw as MaintenanceEnvironment;
}

export function parseMaintenanceArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): MaintenanceArgs {
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    const name = argument.includes("=") ? argument.slice(0, argument.indexOf("=")) : argument;
    if (!argument.includes("=") && valueOptions.has(name) && argv[index + 1] && !argv[index + 1]!.startsWith("--")) {
      index += 1;
    }
  }
  const command = positional.join(" ").trim();
  if (!command) throw new Error("A maintenance command is required");
  const runtimeEnvironment = detectEnvironment(env);
  const options: Partial<MaintenanceRunOptions> = {
    jobType: command,
    jobVersion: "1",
    environment: runtimeEnvironment,
    mode: "dry-run",
    scope: "all",
    all: false,
    allowCloudflare: false,
    allowExternalWrites: false,
    asOf: new Date().toISOString(),
    batchSize: 100,
    maxErrors: 0,
    failOnDrift: false,
    quiet: false,
  };
  let apply = false;
  let dryRun = false;
  let environmentExplicit = false;
  let confirmationSupplied = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const name = argument.includes("=") ? argument.slice(0, argument.indexOf("=")) : argument;
    switch (name) {
      case "--apply":
        if (dryRun) throw new Error("--apply and --dry-run cannot be combined");
        apply = true;
        break;
      case "--dry-run":
        if (apply) throw new Error("--apply and --dry-run cannot be combined");
        dryRun = true;
        options.mode = "dry-run";
        break;
      case "--environment":
        options.environment = value(argv, index, name) as MaintenanceEnvironment;
        if (!environments.has(options.environment)) throw new Error("Unsupported maintenance environment");
        environmentExplicit = true;
        if (!argument.includes("=")) index += 1;
        break;
      case "--confirm-production": {
        const confirmation = value(argv, index, name);
        if (confirmation !== PRODUCTION_CONFIRMATION) throw new Error("Invalid production confirmation");
        confirmationSupplied = true;
        if (!argument.includes("=")) index += 1;
        break;
      }
      case "--job-version":
        options.jobVersion = value(argv, index, name);
        if (!argument.includes("=")) index += 1;
        break;
      case "--scope":
        options.scope = value(argv, index, name);
        if (!argument.includes("=")) index += 1;
        break;
      case "--user-id":
        options.userId = value(argv, index, name).trim();
        if (!options.userId) throw new Error("--user-id must not be empty");
        if (!argument.includes("=")) index += 1;
        break;
      case "--lecture-id":
        options.lectureId = value(argv, index, name).trim();
        if (!options.lectureId) throw new Error("--lecture-id must not be empty");
        if (!argument.includes("=")) index += 1;
        break;
      case "--season-id":
        options.seasonId = value(argv, index, name).trim();
        if (!options.seasonId) throw new Error("--season-id must not be empty");
        if (!argument.includes("=")) index += 1;
        break;
      case "--snapshot-id":
        options.snapshotId = value(argv, index, name).trim();
        if (!options.snapshotId) throw new Error("--snapshot-id must not be empty");
        if (!argument.includes("=")) index += 1;
        break;
      case "--all":
        options.all = true;
        break;
      case "--allow-cloudflare":
        options.allowCloudflare = true;
        break;
      case "--allow-external-writes":
        options.allowExternalWrites = true;
        break;
      case "--before":
        options.before = value(argv, index, name);
        if (!argument.includes("=")) index += 1;
        if (!ISO_TIMESTAMP.test(options.before) || Number.isNaN(Date.parse(options.before))) {
          throw new Error("--before must be an ISO timestamp with a timezone");
        }
        break;
      case "--as-of":
        options.asOf = value(argv, index, name);
        if (!argument.includes("=")) index += 1;
        if (!ISO_TIMESTAMP.test(options.asOf) || Number.isNaN(Date.parse(options.asOf))) {
          throw new Error("--as-of must be an ISO timestamp with a timezone");
        }
        break;
      case "--batch-size":
        options.batchSize = Number(value(argv, index, name));
        if (!argument.includes("=")) index += 1;
        break;
      case "--limit":
        options.limit = Number(value(argv, index, name));
        if (!argument.includes("=")) index += 1;
        break;
      case "--max-errors":
        options.maxErrors = Number(value(argv, index, name));
        if (!argument.includes("=")) index += 1;
        break;
      case "--fail-on-drift":
        options.failOnDrift = true;
        break;
      case "--resume-job":
        options.resumeJobId = value(argv, index, name);
        if (!argument.includes("=")) index += 1;
        break;
      case "--after-id":
        options.afterId = value(argv, index, name);
        if (!argument.includes("=")) index += 1;
        break;
      case "--report-file":
        options.reportFile = value(argv, index, name);
        if (!argument.includes("=")) index += 1;
        break;
      case "--checkpoint-dir":
        options.checkpointDir = value(argv, index, name);
        if (!argument.includes("=")) index += 1;
        break;
      case "--quiet":
        options.quiet = true;
        break;
      default:
        throw new Error(`Unknown maintenance option: ${name}`);
    }
  }
  if (apply) options.mode = "apply";
  if (runtimeEnvironment === "production" && options.environment !== "production") {
    throw new Error("A production runtime cannot target a non-production maintenance environment");
  }
  if (options.environment === "production" && options.mode === "apply" &&
      (!environmentExplicit || !confirmationSupplied)) {
    throw new Error(`Production apply requires --confirm-production=${PRODUCTION_CONFIRMATION}`);
  }
  if (options.resumeJobId && options.afterId) {
    throw new Error("--resume-job and --after-id cannot be combined");
  }
  if (options.all && (options.userId || options.lectureId)) {
    throw new Error("--all cannot be combined with --user-id or --lecture-id");
  }
  if (!options.batchSize || options.batchSize < 1 || options.batchSize > 500) {
    throw new Error("--batch-size must be between 1 and 500");
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  if (!Number.isInteger(options.maxErrors) || options.maxErrors < 0) throw new Error("--max-errors must be non-negative");
  return { command, options: options as MaintenanceRunOptions };
}