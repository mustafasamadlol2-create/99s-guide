import { Prisma, type PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { getActiveGamificationRuleSet } from "../../features/gamification/ruleSetService.js";
import { reconcileUserGamificationLevel } from "../../features/gamification/levelService.js";
import { reconcileStudyPointsAccount } from "../../features/study-points/reconciliation.js";
import { MASTERY_RULE_VERSION } from "../../features/mastery/constants.js";
import { RETENTION_RULE_VERSION } from "../../features/mastery/retentionConstants.js";
import { STUDY_POINTS_LEDGER_VERSION } from "../../features/study-points/constants.js";
import { readOutboxStatus } from "./outbox.js";

type CheckStatus = "PASS" | "WARN" | "FAIL";
type ReadinessCheck = {
  name: string;
  status: CheckStatus;
  detail: unknown;
};

const REQUIRED_TABLES = [
  "User",
  "StudyEvent",
  "FocusSession",
  "GroupFocusRun",
  "GroupFocusParticipantSummary",
  "StudyPointsLedgerEntry",
  "StudyPointsBalanceProjection",
  "GamificationRuleSet",
  "UserAchievementProgress",
  "UserAchievementUnlock",
  "UserGamificationLevel",
  "LectureMastery",
  "LectureRetention",
  "MasteryD1ProjectionState",
  "PrivateD1SyncOutbox",
  "LeaderboardSnapshot",
  "LeaderboardD1SyncOutbox",
] as const;

const REQUIRED_INDEXES = [
  "lecture_mastery_user_lecture_key",
  "lecture_retention_user_lecture_key",
  "leaderboard_d1_outbox_snapshot_work_generation_key",
  "leaderboard_d1_outbox_next_attempt_idx",
] as const;

function check(
  checks: ReadinessCheck[],
  name: string,
  status: CheckStatus,
  detail: ReadinessCheck["detail"],
): void {
  checks.push({ name, status, detail });
}

function safeStatus(value: unknown): string {
  return typeof value === "string" && /^[A-Z0-9_-]{1,80}$/u.test(value) ? value : "UNKNOWN";
}

export async function runReadinessPreflight(
  database: PrismaClient,
  cwd = process.cwd(),
): Promise<{
  jobType: "readiness:preflight";
  mode: "read-only";
  checkedAt: string;
  status: "PASS" | "WARN" | "FAIL";
  writeOperationsPerformed: 0;
  checks: ReadinessCheck[];
  outboxes?: Awaited<ReturnType<typeof readOutboxStatus>>;
}> {
  const checks: ReadinessCheck[] = [];
  const checkedAt = new Date().toISOString();
  try {
    const rows = await database.$queryRaw<Array<{ ok: number }>>(Prisma.sql`SELECT 1::int AS ok`);
    check(checks, "postgres_connectivity", rows[0]?.ok === 1 ? "PASS" : "FAIL", rows[0]?.ok === 1);
  } catch {
    check(checks, "postgres_connectivity", "FAIL", "DATABASE_QUERY_FAILED");
  }

  let tables = new Set<string>();
  try {
    const rows = await database.$queryRaw<Array<{ table_name: string }>>(Prisma.sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    tables = new Set(rows.map((row) => row.table_name));
    const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
    check(checks, "required_tables", missing.length ? "FAIL" : "PASS", missing);
  } catch {
    check(checks, "required_tables", "FAIL", "SCHEMA_CATALOG_QUERY_FAILED");
  }

  try {
    const rows = await database.$queryRaw<Array<{ indexname: string }>>(Prisma.sql`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
    `);
    const indexes = new Set(rows.map((row) => row.indexname));
    const missing = REQUIRED_INDEXES.filter((index) => !indexes.has(index));
    check(checks, "required_indexes", missing.length ? "FAIL" : "PASS", missing);
  } catch {
    check(checks, "required_indexes", "FAIL", "INDEX_CATALOG_QUERY_FAILED");
  }

  try {
    const local = (await readdir(join(cwd, "prisma", "migrations"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    if (!tables.has("_prisma_migrations")) {
      check(checks, "migration_status", "FAIL", "MIGRATION_TABLE_MISSING");
    } else {
      const rows = await database.$queryRaw<Array<{
        migration_name: string;
        finished_at: Date | null;
        rolled_back_at: Date | null;
      }>>(Prisma.sql`
        SELECT migration_name, finished_at, rolled_back_at
        FROM "_prisma_migrations"
        ORDER BY started_at ASC
      `);
      const applied = new Set(rows
        .filter((row) => row.finished_at !== null && row.rolled_back_at === null)
        .map((row) => row.migration_name));
      const missing = local.filter((name) => !applied.has(name));
      const failed = rows
        .filter((row) => row.finished_at === null && row.rolled_back_at === null)
        .map((row) => row.migration_name);
      const status = missing.length || failed.length ? "FAIL" : "PASS";
      check(checks, "migration_status", status, { missing, failed });
    }
  } catch {
    check(checks, "migration_status", "FAIL", "MIGRATION_STATUS_UNAVAILABLE");
  }

  try {
    const active = await getActiveGamificationRuleSet(database);
    check(checks, "active_gamification_ruleset", "PASS", active.ruleSet.version);
  } catch {
    check(checks, "active_gamification_ruleset", "FAIL", "ACTIVE_RULESET_INVALID_OR_MISSING");
  }

  check(checks, "canonical_rule_versions", "PASS", {
    studyPointsLedger: String(STUDY_POINTS_LEDGER_VERSION),
    mastery: MASTERY_RULE_VERSION,
    retention: RETENTION_RULE_VERSION,
  });

  const configPaths = [
    "wrangler.jsonc",
    "cloudflare-private-data-api/wrangler.jsonc",
    "cloudflare-group-focus-worker/wrangler.jsonc",
  ];
  const missingConfigs = configPaths.filter((path) => !existsSync(join(cwd, path)));
  check(checks, "cloudflare_binding_config_files", missingConfigs.length ? "WARN" : "PASS", missingConfigs);

  const featureFlags = [
    "PRIVATE_D1_WRITE_MIRROR_ENABLED",
    "MASTERY_D1_PROJECTION_ENABLED",
    "STUDY_POINTS_READ_MODE",
  ];
  check(checks, "feature_flag_configuration", "PASS", Object.fromEntries(featureFlags.map((flag) => [
    flag,
    process.env[flag] !== undefined,
  ])));

  let outboxes: Awaited<ReturnType<typeof readOutboxStatus>> | undefined;
  try {
    outboxes = await readOutboxStatus(database);
    const pending = outboxes.reduce((sum, row) => sum + row.pending, 0);
    const blocked = outboxes.reduce((sum, row) => sum + row.blocked, 0);
    const poison = outboxes.reduce((sum, row) => sum + row.poison, 0);
    check(checks, "outbox_backlog", pending || blocked || poison ? "WARN" : "PASS", {
      pending,
      blocked,
      poison,
    });
  } catch {
    check(checks, "outbox_backlog", "FAIL", "OUTBOX_STATUS_UNAVAILABLE");
  }

  try {
    const firstUser = await database.user.findFirst({ orderBy: { id: "asc" }, select: { id: true } });
    if (!firstUser) {
      check(checks, "projection_drift_sample", "WARN", "NO_USERS_TO_SAMPLE");
    } else {
      const [points, level] = await Promise.all([
        reconcileStudyPointsAccount({ userId: firstUser.id }, database),
        reconcileUserGamificationLevel(firstUser.id, database),
      ]);
      const pointStatus = safeStatus(points.status);
      const levelStatus = safeStatus(level.status);
      const drift = pointStatus !== "IN_SYNC" || levelStatus !== "IN_SYNC";
      check(checks, "projection_drift_sample", drift ? "WARN" : "PASS", {
        studyPoints: pointStatus,
        level: levelStatus,
      });
    }
  } catch {
    check(checks, "projection_drift_sample", "WARN", "READ_ONLY_SAMPLE_UNAVAILABLE");
  }

  const status = checks.some((item) => item.status === "FAIL")
    ? "FAIL"
    : checks.some((item) => item.status === "WARN")
      ? "WARN"
      : "PASS";
  return {
    jobType: "readiness:preflight",
    mode: "read-only",
    checkedAt,
    status,
    writeOperationsPerformed: 0,
    checks,
    ...(outboxes ? { outboxes } : {}),
  };
}