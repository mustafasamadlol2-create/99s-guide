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

function value(args: string[], index: number, name: string): string {
  const argument = args[index];
  const inline = argument.slice(name.length + 1);
  if (inline) return inline;
  const next = args[index + 1];
  if (!next || next.startsWith("--")) throw new Error(`${name} requires a value`);
  return next;
}

export function detectEnvironment(env: NodeJS.ProcessEnv = process.env): MaintenanceEnvironment {
  const raw = env.MAINTENANCE_ENVIRONMENT ?? env.NODE_ENV ?? "development";
  if (!environments.has(raw as MaintenanceEnvironment)) {
    throw new Error(`Unsupported maintenance environment: ${raw}`);
  }
  return raw as MaintenanceEnvironment;
}

export function parseMaintenanceArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): MaintenanceArgs {
  const command = argv.find((argument) => !argument.startsWith("--"));
  if (!command) throw new Error("A maintenance command is required");
  const options: Partial<MaintenanceRunOptions> = {
    jobType: command,
    jobVersion: "1",
    environment: detectEnvironment(env),
    mode: "dry-run",
    scope: "all",
    asOf: new Date().toISOString(),
    batchSize: 100,
    maxErrors: 0,
    failOnDrift: false,
    quiet: false,
  };
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const name = argument.includes("=") ? argument.slice(0, argument.indexOf("=")) : argument;
    switch (name) {
      case "--apply":
        apply = true;
        break;
      case "--dry-run":
        if (apply) throw new Error("--apply and --dry-run cannot be combined");
        options.mode = "dry-run";
        break;
      case "--environment":
        options.environment = value(argv, index, name) as MaintenanceEnvironment;
        if (!environments.has(options.environment)) throw new Error("Unsupported maintenance environment");
        if (!argument.includes("=")) index += 1;
        break;
      case "--confirm-production": {
        const confirmation = value(argv, index, name);
        if (confirmation !== PRODUCTION_CONFIRMATION) throw new Error("Invalid production confirmation");
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
      case "--as-of":
        options.asOf = value(argv, index, name);
        if (!argument.includes("=")) index += 1;
        if (Number.isNaN(Date.parse(options.asOf))) throw new Error("--as-of must be an ISO timestamp");
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
  if (options.environment === "production" && options.mode === "apply" &&
      !argv.some((arg) => arg === `--confirm-production=${PRODUCTION_CONFIRMATION}` ||
        arg === PRODUCTION_CONFIRMATION)) {
    throw new Error(`Production apply requires --confirm-production=${PRODUCTION_CONFIRMATION}`);
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