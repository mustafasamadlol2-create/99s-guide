import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { disconnectPrisma, getPrisma } from "../../services/prismaClient.js";
import {
  activateGamificationRuleSet,
  bootstrapCurrentGamificationRuleSet,
  ensureGamificationRuleSetDraft,
  getActiveGamificationRuleSet,
} from "../../features/gamification/ruleSetService.js";
import { getCurrentGamificationDefinitionBundle } from "../../features/gamification/definitions.js";
import { GamificationError } from "../../features/gamification/errors.js";
import { reconcileLeaderboardD1Cache } from "../../features/leaderboard/cacheReconciliation.js";
import {
  PRODUCTION_CONFIRMATION,
  parseMaintenanceArgs,
  runMaintenance,
  type MaintenanceAdapter,
  type MaintenanceRunOptions,
} from "../core/index.js";
import {
  createChallengeAdapter,
  createAchievementAdapter,
  createLevelAdapter,
  createMasteryMaintenanceAdapter,
  createPointsAdapter,
  createLegacyPointsBackfillAdapter,
  createPrivateD1Adapter,
  createRetentionMaintenanceAdapter,
  createOutboxAdapter,
  createLeaderboardD1RebuildAdapter,
  createLeaderboardSnapshotAdapter,
  runFocusAudit,
  runGroupFocusAudit,
  readOutboxStatus,
  runReadinessPreflight,
  canonicalMaintenanceScope,
} from "../jobs/index.js";

const HELP = `Study Engine maintenance (read-only by default)

Usage:
  npm run study-maintenance -- points audit --user-id <id>
  npm run study-maintenance -- points rebuild --all [--apply]
  npm run study-maintenance -- points backfill-legacy --user-id <id> [--apply]
  npm run study-maintenance -- points backfill-legacy --all [--apply]
  npm run study-maintenance -- level audit --user-id <id>
  npm run study-maintenance -- achievements audit --user-id <id> --as-of <ISO timestamp>
  npm run study-maintenance -- achievements rebuild --all --as-of <ISO timestamp> [--apply]
  npm run study-maintenance -- challenges audit progress --user-id <id>
  npm run study-maintenance -- challenges rebuild current-window progress --user-id <id> [--apply]
  npm run study-maintenance -- mastery audit --user-id <id> [--lecture-id <id>]
  npm run study-maintenance -- mastery rebuild --all [--apply]
  npm run study-maintenance -- retention audit --user-id <id>
  npm run study-maintenance -- retention rebuild --user-id <id> --as-of <ISO timestamp> [--apply]
  npm run study-maintenance -- private-d1 audit --user-id <id> --allow-cloudflare
  npm run study-maintenance -- private-d1 rebuild --all --allow-cloudflare [--apply --allow-external-writes]
  npm run study-maintenance -- outbox status
  npm run study-maintenance -- outbox replay --allow-cloudflare --allow-external-writes [--apply]
  npm run study-maintenance -- outbox compact --older-than-days <days> [--apply]
  npm run study-maintenance -- ruleset audit
  npm run study-maintenance -- ruleset bootstrap --apply
  npm run study-maintenance -- ruleset activate --apply
  npm run study-maintenance -- focus audit --all [--limit <n>]
  npm run study-maintenance -- group-focus audit --all [--limit <n>]
  npm run study-maintenance -- orphans audit
  npm run study-maintenance -- compatibility audit
  npm run study-maintenance -- leaderboard audit snapshot --season-id <id> [--snapshot-id <id>]
  npm run study-maintenance -- leaderboard d1 audit --snapshot-id <id> --allow-cloudflare
  npm run study-maintenance -- leaderboard d1 rebuild --snapshot-id <id> [--apply --allow-external-writes]

Safety:
  Writes require --apply. Without it, commands only inspect and report.
  --all is required for an unscoped user-wide scan.
  Achievement rebuild writes progress only; it never creates or removes permanent unlocks.
  A completed achievement without an unlock is reported for review, not backfilled.
  General production apply is disabled while maintenance checkpoints are local-only.
  Atomic ruleset bootstrap/activation are the only production apply exceptions.
  Production ruleset writes require --apply, --environment=production, and the confirmation token.
`;

function safeFailure(message: string): Error {
  return new Error(`MAINTENANCE_SAFE: ${message}`);
}

function rulesetErrorDetail(error: unknown): { code: string; message: string } {
  return {
    code: error instanceof GamificationError
      ? error.code
      : "GAMIFICATION_RULE_SET_CHECK_FAILED",
    message: error instanceof Error
      ? error.message.slice(0, 240)
      : "The active Gamification ruleset could not be verified.",
  };
}

function canonicalScope(options: MaintenanceRunOptions, allowLecture: boolean): string {
  if (options.scope !== "all") {
    throw safeFailure("Use --user-id, --lecture-id, and --all to define scope; raw --scope is not accepted.");
  }
  if (options.all && (options.userId || options.lectureId)) {
    throw safeFailure("--all cannot be combined with ID filters.");
  }
  if (!options.all && !options.userId && !options.lectureId) {
    throw safeFailure("Specify --user-id, --lecture-id, or --all; unscoped maintenance is not allowed.");
  }
  if (!allowLecture && options.lectureId) {
    throw safeFailure("--lecture-id is supported only for Mastery and Retention commands.");
  }
  return canonicalMaintenanceScope({
    ...(options.userId ? { userId: options.userId } : {}),
    ...(options.lectureId ? { lectureId: options.lectureId } : {}),
    ...(options.all ? { all: true } : {}),
  });
}

function selectAdapter(
  command: string,
  options: MaintenanceRunOptions,
  database: PrismaClient,
  argv: string[],
): MaintenanceAdapter {
  const normalized = command.toLowerCase().replace(/\s+/gu, " ").trim();
  const auditOnly = /\baudit\b/u.test(normalized);
  if (auditOnly && options.mode === "apply") {
    throw safeFailure("Audit commands are read-only; remove --apply.");
  }

  if (normalized === "achievements audit" || normalized === "achievements rebuild") {
    options.jobType = normalized.endsWith("audit")
      ? "achievements:audit-progress"
      : "achievements:rebuild-progress";
    options.scope = canonicalScope(options, false);
    return createAchievementAdapter({ database });
  }

  if (normalized === "points backfill-legacy") {
    options.jobType = "points:backfill-legacy";
    options.scope = canonicalScope(options, false);
    return createLegacyPointsBackfillAdapter({ database });
  }

  if (normalized === "points audit" || normalized === "points rebuild") {
    options.jobType = `points:${normalized.endsWith("audit") ? "audit" : "rebuild"}`;
    options.scope = canonicalScope(options, false);
    return createPointsAdapter({ database });
  }
  if (normalized === "level audit" || normalized === "level rebuild"
    || normalized === "levels audit" || normalized === "levels rebuild") {
    options.jobType = `level:${normalized.endsWith("audit") ? "audit" : "rebuild"}`;
    options.scope = canonicalScope(options, false);
    return createLevelAdapter({ database });
  }
  if (normalized === "challenges audit progress"
    || normalized === "challenges rebuild current-window progress") {
    options.jobType = normalized.startsWith("challenges audit") ? "challenges:audit" : "challenges:rebuild-current-window";
    options.scope = canonicalScope(options, false);
    if (options.lectureId) throw safeFailure("Challenge maintenance does not accept --lecture-id.");
    return createChallengeAdapter({ database });
  }
  if (normalized === "mastery audit" || normalized === "mastery rebuild") {
    options.jobType = `mastery:${normalized.endsWith("audit") ? "audit" : "rebuild"}`;
    options.scope = canonicalScope(options, true);
    return createMasteryMaintenanceAdapter({ database });
  }
  if (normalized === "retention audit" || normalized === "retention rebuild") {
    options.jobType = `retention:${normalized.endsWith("audit") ? "audit" : "rebuild"}`;
    options.scope = canonicalScope(options, true);
    if (normalized.endsWith("rebuild")
      && !argv.some((argument) => argument === "--as-of" || argument.startsWith("--as-of="))) {
      throw safeFailure("Retention rebuild requires a fixed --as-of timestamp.");
    }
    return createRetentionMaintenanceAdapter({ database });
  }
  if (normalized === "private-d1 audit" || normalized === "private-d1 rebuild") {
    if (!options.allowCloudflare) {
      throw safeFailure("Private D1 reconciliation reads a Cloudflare Worker; pass --allow-cloudflare to permit that access.");
    }
    if (!options.all && !options.userId) {
      throw safeFailure("Private D1 maintenance requires --user-id or --all.");
    }
    if (normalized.endsWith("rebuild") && options.mode === "apply" && !options.allowExternalWrites) {
      throw safeFailure("Private D1 rebuild may trigger queued Worker delivery; --apply requires --allow-external-writes.");
    }
    if (options.scope !== "all") {
      throw safeFailure("Use --user-id and --all; raw --scope is not accepted.");
    }
    options.jobType = normalized.endsWith("audit") ? "private-d1:audit" : "private-d1:rebuild";
    options.scope = canonicalMaintenanceScope({
      ...(options.userId ? { userId: options.userId } : {}),
      ...(options.all ? { all: true } : {}),
    });
    return createPrivateD1Adapter({ database, lectureId: options.lectureId });
  }
  if (normalized === "leaderboard audit snapshot" || normalized === "leaderboard rebuild snapshot") {
    if (options.scope !== "all" || options.all || options.userId || options.lectureId) {
      throw safeFailure("Leaderboard snapshot reconciliation accepts only --season-id and optional --snapshot-id.");
    }
    if (!options.seasonId) throw safeFailure("Leaderboard snapshot reconciliation requires --season-id.");
    options.jobType = normalized.startsWith("leaderboard audit") ? "leaderboard:audit-snapshot" : "leaderboard:rebuild-snapshot";
    options.scope = JSON.stringify({
      seasonId: options.seasonId,
      snapshotId: options.snapshotId ?? null,
    });
    return createLeaderboardSnapshotAdapter({
      database,
      seasonId: options.seasonId,
      ...(options.snapshotId ? { snapshotId: options.snapshotId } : {}),
      asOf: options.asOf,
    });
  }
  if (normalized === "leaderboard d1 rebuild") {
    if (options.scope !== "all" || options.all || options.userId || options.lectureId || options.seasonId) {
      throw safeFailure("Leaderboard D1 rebuild accepts only --snapshot-id.");
    }
    if (!options.snapshotId) throw safeFailure("Leaderboard D1 rebuild requires --snapshot-id.");
    if (options.mode === "apply" && !options.allowExternalWrites) {
      throw safeFailure("Leaderboard D1 rebuild queues work for an external Worker; --apply requires --allow-external-writes.");
    }
    options.jobType = "leaderboard:d1-rebuild";
    options.scope = JSON.stringify({ snapshotId: options.snapshotId });
    return createLeaderboardD1RebuildAdapter({ database, snapshotId: options.snapshotId });
  }
  if (normalized === "outbox replay" || normalized === "outbox compact") {
    if (options.scope !== "all" || options.userId || options.lectureId || options.all) {
      throw safeFailure("Outbox operations do not accept user or content scopes.");
    }
    if (normalized.endsWith("compact") && (!options.before && options.olderThanDays === undefined)) {
      throw safeFailure("Outbox compaction requires --older-than-days or --before as an explicit cutoff.");
    }
    if (normalized.endsWith("compact") && options.before && options.olderThanDays !== undefined) {
      throw safeFailure("Choose either --older-than-days or --before, not both.");
    }
    if (normalized.endsWith("replay") && (options.before || options.olderThanDays !== undefined)) {
      throw safeFailure("Outbox replay does not accept compaction cutoffs.");
    }
    if (normalized.endsWith("replay") && options.mode === "apply"
      && (!options.allowCloudflare || !options.allowExternalWrites)) {
      throw safeFailure("Outbox replay can trigger Worker delivery; --apply requires both --allow-cloudflare and --allow-external-writes.");
    }
    options.jobType = normalized.endsWith("replay") ? "outbox:replay" : "outbox:compact";
    options.scope = "bounded-outbox";
    const before = options.before ?? (
      options.olderThanDays !== undefined
        ? new Date(Date.parse(options.asOf) - options.olderThanDays * 24 * 60 * 60 * 1000).toISOString()
        : undefined
    );
    return createOutboxAdapter({
      database,
      operation: normalized.endsWith("replay") ? "replay" : "compact",
      ...(before ? { before } : {}),
      asOf: options.asOf,
    });
  }
  throw safeFailure(
    `Unsupported maintenance command "${normalized}". This CLI only exposes operations with verified safe implementations; see docs/STUDY_ENGINE_MAINTENANCE_RUNBOOK.md.`,
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    console.log(HELP);
    return;
  }

  let parsed;
  try {
    parsed = parseMaintenanceArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid maintenance arguments.";
    throw safeFailure(message);
  }
  const { command, options } = parsed;
  const normalizedCommand = command.toLowerCase().replace(/\s+/gu, " ").trim();
  const isRuleSetLifecycleCommand = normalizedCommand === "ruleset bootstrap"
    || normalizedCommand === "ruleset activate";
  if (
    options.environment === "production"
    && options.mode === "apply"
    && !isRuleSetLifecycleCommand
  ) {
    throw safeFailure(
      `Production maintenance apply is disabled until a durable shared checkpoint store exists. Only the atomic ruleset bootstrap/activation commands are exempt; the confirmation token is ${PRODUCTION_CONFIRMATION}.`,
    );
  }
  if (!process.env.DATABASE_URL && !process.env.SUPABASE_DATABASE_URL) {
    throw safeFailure("No database URL is configured; maintenance cannot start.");
  }

  const database = getPrisma() as PrismaClient;
  try {
    await database.$connect();
    if (normalizedCommand === "readiness preflight") {
      if (options.mode === "apply") throw safeFailure("Readiness preflight is read-only; remove --apply.");
      const report = await runReadinessPreflight(database);
      if (options.reportFile) {
        await mkdir(dirname(options.reportFile), { recursive: true });
        await writeFile(options.reportFile, `${JSON.stringify(report, null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
      }
      console.log(JSON.stringify(report, null, 2));
      if (report.status === "FAIL") process.exitCode = 1;
      return;
    }
    if (normalizedCommand === "orphans audit" || normalizedCommand === "compatibility audit") {
      if (options.mode === "apply") throw safeFailure("Maintenance audits are read-only; remove --apply.");
      const report = normalizedCommand === "orphans audit"
        ? (await import("../jobs/audits.js")).runOrphanAudit(database)
        : (await import("../jobs/audits.js")).runCompatibilityAudit(database);
      const resolved = await report;
      if (options.reportFile) {
        await mkdir(dirname(options.reportFile), { recursive: true });
        await writeFile(options.reportFile, `${JSON.stringify(resolved, null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
      }
      console.log(JSON.stringify(resolved, null, 2));
      if (resolved.status !== "PASS") process.exitCode = 1;
      return;
    }
    if (normalizedCommand === "focus audit" || normalizedCommand === "group-focus audit") {
      if (options.mode === "apply") throw safeFailure("Focus integrity audits are read-only; remove --apply.");
      if (!options.all || options.userId || options.lectureId) {
        throw safeFailure("Focus integrity audits are bounded global checks and require --all without ID filters.");
      }
      const report = normalizedCommand === "focus audit"
        ? await runFocusAudit({ database, asOf: options.asOf, limit: options.limit ?? options.batchSize })
        : await runGroupFocusAudit({ database, asOf: options.asOf, limit: options.limit ?? options.batchSize });
      if (options.reportFile) {
        await mkdir(dirname(options.reportFile), { recursive: true });
        await writeFile(options.reportFile, `${JSON.stringify(report, null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
      }
      console.log(JSON.stringify(report, null, 2));
      if (report.status === "WARN") process.exitCode = 1;
      return;
    }
    if (isRuleSetLifecycleCommand) {
      if (options.mode !== "apply") {
        throw safeFailure("Ruleset bootstrap and activation write the active registry; pass --apply explicitly.");
      }
      const currentBundle = getCurrentGamificationDefinitionBundle();
      let operation: string;
      let outcome: string;
      let activeRuleSet;
      if (normalizedCommand === "ruleset bootstrap") {
        const result = await bootstrapCurrentGamificationRuleSet(database);
        operation = "ruleset:bootstrap";
        outcome = result.outcome;
        activeRuleSet = result.ruleSet;
      } else {
        await ensureGamificationRuleSetDraft(currentBundle.version, database);
        activeRuleSet = await activateGamificationRuleSet(
          currentBundle.version,
          database,
        );
        operation = "ruleset:activate";
        outcome = "CURRENT_SOURCE_VERSION_ACTIVE";
      }
      const report = {
        jobType: operation,
        environment: options.environment,
        asOf: options.asOf,
        status: "PASS",
        outcome,
        activeRuleSetVersion: activeRuleSet.version,
        activeRuleSetStatus: activeRuleSet.status,
        currentSourceVersion: currentBundle.version,
        checksumsValidated: true,
      };
      if (options.reportFile) {
        await mkdir(dirname(options.reportFile), { recursive: true });
        await writeFile(options.reportFile, `${JSON.stringify(report, null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
      }
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    if (normalizedCommand === "ruleset audit") {
      if (options.mode === "apply") throw safeFailure("Ruleset audit is read-only; remove --apply.");
      const currentBundle = getCurrentGamificationDefinitionBundle();
      let report: Record<string, unknown>;
      try {
        const active = await getActiveGamificationRuleSet(database);
        report = {
          jobType: "ruleset:audit",
          environment: options.environment,
          asOf: options.asOf,
          status: "PASS",
          currentSourceVersion: currentBundle.version,
          activeRuleSetVersion: active.ruleSet.version,
          checks: {
            exactlyOneActiveRuleSet: true,
            currentSourceVersionActive: true,
            allStoredChecksumsMatch: true,
            activeLifecycleTimestampsValid: true,
          },
        };
      } catch (error) {
        report = {
          jobType: "ruleset:audit",
          environment: options.environment,
          asOf: options.asOf,
          status: "FAIL",
          currentSourceVersion: currentBundle.version,
          activeRuleSetVersion: null,
          checks: {
            exactlyOneActiveRuleSet: false,
            currentSourceVersionActive: false,
            allStoredChecksumsMatch: false,
            activeLifecycleTimestampsValid: false,
          },
          diagnostic: rulesetErrorDetail(error),
        };
      }
      if (options.reportFile) {
        await mkdir(dirname(options.reportFile), { recursive: true });
        await writeFile(options.reportFile, `${JSON.stringify(report, null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
      }
      console.log(JSON.stringify(report, null, 2));
      if (report.status !== "PASS") process.exitCode = 1;
      return;
    }
    if (normalizedCommand === "leaderboard d1 audit") {
      if (options.mode === "apply") throw safeFailure("Leaderboard D1 audit is read-only; remove --apply.");
      if (!options.allowCloudflare) throw safeFailure("Leaderboard D1 audit reads Cloudflare; pass --allow-cloudflare.");
      if (!options.snapshotId) throw safeFailure("Leaderboard D1 audit requires --snapshot-id.");
      const audit = await reconcileLeaderboardD1Cache({
        snapshotId: options.snapshotId,
        database,
      });
      const report = {
        jobType: "leaderboard:d1-audit",
        environment: options.environment,
        asOf: options.asOf,
        status: audit.status,
        snapshotId: audit.snapshotId,
        checks: audit.checks.map((entry) => ({ code: entry.code })),
      };
      console.log(JSON.stringify(report, null, 2));
      if (audit.status !== "MATCHED") process.exitCode = 1;
      return;
    }
    if (normalizedCommand === "outbox status") {
      if (options.mode === "apply") throw safeFailure("Outbox status is read-only; remove --apply.");
      const outboxes = await readOutboxStatus(database);
      console.log(JSON.stringify({
        jobType: "outbox:status",
        environment: options.environment,
        asOf: options.asOf,
        outboxes,
      }, null, 2));
      return;
    }
    const adapter = selectAdapter(command, options, database, argv);
    const report = await runMaintenance(options, adapter, {
      checkpointDir: options.checkpointDir,
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.errors > 0) process.exitCode = 1;
  } finally {
    await disconnectPrisma();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error && error.message.startsWith("MAINTENANCE_SAFE:")
    ? error.message.slice("MAINTENANCE_SAFE:".length).trim()
    : "Maintenance failed safely. Inspect the structured report and logs without exposing connection details.";
  console.error(message);
  process.exitCode = 1;
});