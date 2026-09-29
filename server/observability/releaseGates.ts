import { Prisma, type PrismaClient } from "@prisma/client";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readOutboxStatus } from "../study-maintenance/jobs/outbox.js";
import {
  runStudyCohortAudit,
  type StudyCohortAuditCounts,
} from "./cohortAudit.js";
import type {
  ReleaseCheckReport,
  ReleaseGateResult,
  ReleaseGateStatus,
} from "./types.js";

const REQUIRED_TABLES = [
  "User",
  "StudyEvent",
  "FocusSession",
  "UserAchievementProgress",
  "UserAchievementUnlock",
  "UserGamificationLevel",
  "GroupFocusRoom",
  "GroupFocusRun",
  "GroupFocusParticipantSummary",
  "StudyPointsLedgerEntry",
  "StudyPointsBalanceProjection",
  "GamificationRuleSet",
  "LectureMastery",
  "LectureRetention",
  "MasteryD1ProjectionState",
  "PrivateD1SyncOutbox",
  "LeaderboardSnapshot",
  "LeaderboardD1SyncOutbox",
] as const;

export function releaseGate(
  gate: string,
  status: ReleaseGateStatus,
  code: string,
  message: string,
): ReleaseGateResult {
  return { gate, status, code, message };
}

export function buildReleaseReport(input: {
  target: "local" | "staging";
  mode: "fast" | "deep";
  gates: ReleaseGateResult[];
  checkedAt?: string;
}): ReleaseCheckReport {
  const status = input.gates.some((gate) => gate.status === "FAIL")
    ? "NOT_READY"
    : input.gates.some((gate) => gate.status === "WARN")
      ? "READY_WITH_WARNINGS"
      : "READY";
  return {
    version: "study-release-check-v1",
    target: input.target,
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    mode: input.mode,
    status,
    writeOperationsPerformed: 0,
    gates: input.gates,
  };
}

export function validateFeatureConfiguration(
  flags: Readonly<Record<string, boolean>>,
  environment: Readonly<Record<string, string | undefined>>,
): ReleaseGateResult {
  const impossible: string[] = [];
  if (flags.LEADERBOARD_D1_READ_ENABLED && !flags.LEADERBOARD_D1_PROJECTION_ENABLED) {
    impossible.push("leaderboard D1 reads require its projection to be enabled");
  }
  if (flags.ASK_MY_STUDY_DATA_AI_ENABLED && !flags.ASK_MY_STUDY_DATA_ENABLED) {
    impossible.push("Ask My Study Data AI requires Ask My Study Data");
  }
  if (flags.AI_STUDY_INSIGHTS_CACHE_ENABLED && !flags.AI_STUDY_INSIGHTS_ENABLED) {
    impossible.push("AI Insights cache requires AI Insights");
  }
  if (
    environment.VITE_GROUP_FOCUS_FRONTEND_ENABLED === "true"
    && !flags.GROUP_FOCUS_ENABLED
  ) {
    impossible.push("Group Focus frontend is enabled while its backend feature is disabled");
  }
  if (
    environment.VITE_STUDY_INSIGHTS_FRONTEND_ENABLED === "true"
    && !flags.AI_STUDY_INSIGHTS_ENABLED
  ) {
    impossible.push("Study Insights frontend is enabled while its backend feature is disabled");
  }
  if (
    environment.VITE_OWNER_ANALYTICS_FRONTEND_ENABLED === "true"
    && !flags.OWNER_STUDY_ANALYTICS_ENABLED
  ) {
    impossible.push("Owner Analytics frontend is enabled while its backend feature is disabled");
  }

  return impossible.length > 0
    ? releaseGate(
      "feature_config",
      "FAIL",
      "IMPOSSIBLE_FEATURE_COMBINATION",
      impossible.join("; "),
    )
    : releaseGate(
      "feature_config",
      "PASS",
      "FEATURE_PROFILE_VALID",
      "Feature profile contains no known impossible combinations.",
    );
}

export function validateTargetDatabaseUrl(input: {
  target: "local" | "staging";
  value: string | undefined;
}): { ok: true; value: string } | { ok: false; reason: string } | { ok: true; value: null } {
  if (!input.value?.trim()) return { ok: true, value: null };
  let parsed: URL;
  try {
    parsed = new URL(input.value);
  } catch {
    return { ok: false, reason: "DATABASE_URL_INVALID" };
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return { ok: false, reason: "DATABASE_URL_SCHEME_NOT_ALLOWED" };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (/(^|[.-])prod(?:uction)?([.-]|$)/iu.test(hostname)) {
    return { ok: false, reason: "PRODUCTION_DATABASE_HOST_REJECTED" };
  }
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(hostname);
  if (input.target === "local" && !isLoopback) {
    return { ok: false, reason: "LOCAL_TARGET_REQUIRES_LOOPBACK_DATABASE" };
  }
  if (input.target === "staging" && isLoopback) {
    return { ok: false, reason: "STAGING_TARGET_REQUIRES_NONLOCAL_DATABASE" };
  }
  return { ok: true, value: input.value };
}

export function evaluateOutboxReleaseGate(input: {
  pending: number;
  blocked: number;
  poison: number;
  highAttempts: number;
  maxPending?: number;
}): ReleaseGateResult {
  if (input.blocked > 0 || input.poison > 0 || input.highAttempts > 0) {
    return releaseGate(
      "projection_outbox",
      "FAIL",
      "OUTBOX_REQUIRES_ATTENTION",
      "Blocked, poison, or high-attempt projection work exists; review the read-only maintenance report.",
    );
  }
  if (input.maxPending === undefined) {
    return releaseGate(
      "projection_outbox",
      "WARN",
      "OUTBOX_THRESHOLD_NOT_CONFIGURED",
      "Pending work was checked, but STUDY_RELEASE_MAX_PENDING_OUTBOX is not configured.",
    );
  }
  return input.pending > input.maxPending
    ? releaseGate(
      "projection_outbox",
      "FAIL",
      "OUTBOX_THRESHOLD_EXCEEDED",
      "Pending projection work exceeds the configured release guardrail.",
    )
    : releaseGate(
      "projection_outbox",
      "PASS",
      "OUTBOX_WITHIN_GUARDRAIL",
      "Pending projection work is within the configured release guardrail.",
    );
}

export function evaluateStudyCohortAuditCounts(
  counts: StudyCohortAuditCounts,
): ReleaseGateResult[] {
  const ledgerIssues = [
    counts.zeroValueEntries,
    counts.invalidCategories,
    counts.invalidReversals,
    counts.duplicateSourceAwards,
    counts.duplicateConsistencyAwards,
    counts.duplicateLegacyBaselines,
    counts.categoryCapViolations,
    counts.totalCapViolations,
    counts.socialBonusCapViolations,
  ].reduce((sum, value) => sum + value, 0n);
  return [
    releaseGate(
      "ledger_invariant",
      ledgerIssues > 0n ? "FAIL" : "PASS",
      ledgerIssues > 0n ? "CANONICAL_LEDGER_INVARIANT_FAILED" : "CANONICAL_LEDGER_INVARIANTS_VALID",
      ledgerIssues > 0n
        ? "The aggregate audit found canonical Study Points ledger invariant violations."
        : "The aggregate audit found no canonical Study Points ledger invariant violations.",
    ),
    releaseGate(
      "projection_drift",
      counts.projectionDriftRows > 0n ? "FAIL" : "PASS",
      counts.projectionDriftRows > 0n ? "STUDY_POINTS_PROJECTION_DRIFT" : "STUDY_POINTS_PROJECTION_IN_SYNC",
      counts.projectionDriftRows > 0n
        ? "The aggregate audit found Study Points balance projection drift."
        : "The aggregate audit found no Study Points balance projection drift.",
    ),
  ];
}

export async function inspectReleaseDatabase(
  database: PrismaClient,
  options: { maxPending?: number; runCohortAudits?: boolean } = {},
): Promise<ReleaseGateResult[]> {
  try {
    const connectivity = await database.$queryRaw<Array<{ ok: number }>>(
      Prisma.sql`SELECT 1::int AS ok`,
    );
    if (connectivity[0]?.ok !== 1) {
      throw new Error("DATABASE_QUERY_FAILED");
    }
    const tableRows = await database.$queryRaw<Array<{ table_name: string }>>(Prisma.sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    const present = new Set(tableRows.map((row) => row.table_name));
    const missingTableCount = REQUIRED_TABLES.filter((table) => !present.has(table)).length;
    const schemaGate = missingTableCount > 0
      ? releaseGate(
        "schema_compatibility",
        "FAIL",
        "REQUIRED_SCHEMA_OBJECTS_MISSING",
        "Required Study Engine schema objects are missing.",
      )
      : releaseGate(
        "schema_compatibility",
        "PASS",
        "SCHEMA_COMPATIBLE",
        "Required Study Engine schema objects are present.",
      );

    let migrationGate: ReleaseGateResult;
    if (!present.has("_prisma_migrations")) {
      migrationGate = releaseGate(
        "migration_status",
        "FAIL",
        "MIGRATION_TABLE_MISSING",
        "Migration status cannot be verified because the migration table is missing.",
      );
    } else {
      const rows = await database.$queryRaw<Array<{ applied: bigint; unresolved: bigint }>>(Prisma.sql`
        SELECT
          COUNT(*) FILTER (
            WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
          )::bigint AS applied,
          COUNT(*) FILTER (
            WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL
          )::bigint AS unresolved
        FROM "_prisma_migrations"
      `);
      const localMigrations = await readdir(join(process.cwd(), "prisma", "migrations"), {
        withFileTypes: true,
      });
      const localCount = localMigrations.filter((entry) => entry.isDirectory()).length;
      const appliedCount = Number(rows[0]?.applied ?? 0);
      const unresolvedCount = Number(rows[0]?.unresolved ?? 0);
      migrationGate = unresolvedCount > 0 || appliedCount !== localCount
        ? releaseGate(
          "migration_status",
          "FAIL",
          "MIGRATIONS_NOT_CURRENT",
          "The database has unresolved or unapplied local migrations.",
        )
        : releaseGate(
          "migration_status",
          "PASS",
          "MIGRATIONS_CURRENT",
          "Migration records match the local migration set.",
        );
    }

    const outboxes = await readOutboxStatus(database);
    const pending = outboxes.reduce((sum, item) => sum + item.pending, 0);
    const blocked = outboxes.reduce((sum, item) => sum + item.blocked, 0);
    const poison = outboxes.reduce((sum, item) => sum + item.poison, 0);
    const highAttempts = outboxes.reduce((sum, item) => sum + item.highAttempts, 0);
    const outboxGate = evaluateOutboxReleaseGate({
      pending,
      blocked,
      poison,
      highAttempts,
      maxPending: options.maxPending,
    });
    const gates = [
      releaseGate(
        "postgres_connectivity",
        "PASS",
        "POSTGRES_READ_ONLY_QUERY_OK",
        "The explicit target database answered a lightweight read-only query.",
      ),
      schemaGate,
      migrationGate,
      outboxGate,
      releaseGate(
        "ledger_invariant",
        "WARN",
        "LEDGER_AUDIT_NOT_ATTACHED",
        "No privacy-safe canonical ledger audit summary was supplied; no cohort-wide scan was run.",
      ),
      releaseGate(
        "projection_drift",
        "WARN",
        "PROJECTION_AUDIT_NOT_RUN",
        "No cohort-wide projection audit was run.",
      ),
    ];
    if (!options.runCohortAudits) return gates;
    try {
      const audited = evaluateStudyCohortAuditCounts(
        await runStudyCohortAudit(database),
      );
      return gates.map((gate) =>
        gate.gate === "ledger_invariant" || gate.gate === "projection_drift"
          ? audited.find((result) => result.gate === gate.gate) ?? gate
          : gate);
    } catch {
      return gates.map((gate) =>
        gate.gate === "ledger_invariant" || gate.gate === "projection_drift"
          ? releaseGate(
            gate.gate,
            "FAIL",
            "COHORT_AUDIT_FAILED",
            "The requested aggregate audit did not complete; no repair was attempted.",
          )
          : gate);
    }
  } catch {
    return [
      releaseGate(
        "postgres_connectivity",
        "FAIL",
        "POSTGRES_READ_ONLY_QUERY_FAILED",
        "The explicit target database failed a read-only health query.",
      ),
      releaseGate(
        "schema_compatibility",
        "FAIL",
        "SCHEMA_STATUS_UNAVAILABLE",
        "Schema compatibility could not be verified.",
      ),
      releaseGate(
        "migration_status",
        "FAIL",
        "MIGRATION_STATUS_UNAVAILABLE",
        "Migration status could not be verified.",
      ),
      releaseGate(
        "projection_outbox",
        "FAIL",
        "OUTBOX_STATUS_UNAVAILABLE",
        "Projection outbox status could not be verified.",
      ),
      releaseGate(
        "ledger_invariant",
        "SKIP",
        "DATABASE_REQUIRED",
        "Ledger audit was skipped because the database check failed.",
      ),
      releaseGate(
        "projection_drift",
        "SKIP",
        "DATABASE_REQUIRED",
        "Projection audit was skipped because the database check failed.",
      ),
    ];
  }
}

export function summarizeReleaseReport(report: ReleaseCheckReport): string {
  return [
    `Study Engine release check: ${report.status}`,
    `Target: ${report.target}; mode: ${report.mode}`,
    ...report.gates.map((gate) => `[${gate.status}] ${gate.gate}: ${gate.message}`),
  ].join("\n");
}