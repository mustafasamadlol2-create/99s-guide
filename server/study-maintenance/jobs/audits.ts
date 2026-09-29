import { Prisma, type PrismaClient } from "@prisma/client";
import { MASTERY_RULE_VERSION } from "../../features/mastery/constants.js";
import { RETENTION_RULE_VERSION } from "../../features/mastery/retentionConstants.js";
import { STUDY_POINTS_LEDGER_VERSION } from "../../features/study-points/constants.js";
import {
  LEGACY_POINTS_RULE_VERSION,
  STUDY_POINTS_AWARD_RULES,
  STUDY_POINTS_RULE_DESCRIPTORS,
} from "../../features/study-points/index.js";
import {
  LEADERBOARD_CACHE_RANKING_VERSION,
} from "../../features/leaderboard/cacheProtocol.js";
import { GAMIFICATION_DEFINITION_SCHEMA_VERSION } from "../../features/gamification/constants.js";
import { GAMIFICATION_V1_RULE_SET_VERSION } from "../../features/gamification/definitions.js";

type AuditStatus = "PASS" | "WARN" | "UNSUPPORTED";
type Check = { name: string; status: AuditStatus; inspected: number; orphaned?: number; detail?: unknown };

function count(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return 0;
}

function overall(checks: Check[]): AuditStatus {
  if (checks.some((check) => check.status === "WARN")) return "WARN";
  if (checks.some((check) => check.status === "UNSUPPORTED")) return "UNSUPPORTED";
  return "PASS";
}

/**
 * Read-only orphan inventory. Foreign keys normally make these counts zero,
 * but keeping the checks explicit catches drifted/imported schemas without
 * ever deleting a canonical or derived row.
 */
export async function runOrphanAudit(database: PrismaClient): Promise<{
  jobType: "orphans:audit";
  mode: "read-only";
  status: AuditStatus;
  writeOperationsPerformed: 0;
  checks: Check[];
}> {
  const checks: Check[] = [];
  const projection = await database.$queryRaw<Array<{ inspected: bigint; orphaned: bigint }>>(Prisma.sql`
    SELECT
      (SELECT COUNT(*) FROM "StudyPointsBalanceProjection")
      + (SELECT COUNT(*) FROM "LectureMastery")
      + (SELECT COUNT(*) FROM "LectureRetention")
      + (SELECT COUNT(*) FROM "UserAchievementProgress")
      + (SELECT COUNT(*) FROM "UserChallengeProgress")
      + (SELECT COUNT(*) FROM "LeaderboardSnapshotEntry") AS inspected,
      (SELECT COUNT(*) FROM "StudyPointsBalanceProjection" p LEFT JOIN "User" u ON u.id = p."userId" WHERE u.id IS NULL)
      + (SELECT COUNT(*) FROM "LectureMastery" p LEFT JOIN "User" u ON u.id = p."userId" WHERE u.id IS NULL)
      + (SELECT COUNT(*) FROM "LectureRetention" p LEFT JOIN "User" u ON u.id = p."userId" WHERE u.id IS NULL)
      + (SELECT COUNT(*) FROM "UserAchievementProgress" p LEFT JOIN "User" u ON u.id = p."userId" WHERE u.id IS NULL)
      + (SELECT COUNT(*) FROM "UserChallengeProgress" p LEFT JOIN "User" u ON u.id = p."userId" WHERE u.id IS NULL)
      + (SELECT COUNT(*) FROM "LeaderboardSnapshotEntry" p LEFT JOIN "User" u ON u.id = p."userId" WHERE u.id IS NULL) AS orphaned
  `);
  const projectionRow = projection[0] ?? { inspected: 0n, orphaned: 0n };
  checks.push({
    name: "postgres_derived_projection_user",
    status: count(projectionRow.orphaned) ? "WARN" : "PASS",
    inspected: count(projectionRow.inspected),
    orphaned: count(projectionRow.orphaned),
  });

  const levels = await database.$queryRaw<Array<{ inspected: bigint; orphaned: bigint }>>(Prisma.sql`
    SELECT COUNT(*) AS inspected,
      COUNT(*) FILTER (WHERE u.id IS NULL) AS orphaned
    FROM "UserGamificationLevel" l
    LEFT JOIN "User" u ON u.id = l."userId"
  `);
  const levelRow = levels[0] ?? { inspected: 0n, orphaned: 0n };
  checks.push({
    name: "derived_level_user",
    status: count(levelRow.orphaned) ? "WARN" : "PASS",
    inspected: count(levelRow.inspected),
    orphaned: count(levelRow.orphaned),
  });

  const outbox = await database.$queryRaw<Array<{ inspected: bigint; impossible: bigint }>>(Prisma.sql`
    SELECT
      (SELECT COUNT(*) FROM "PrivateD1SyncOutbox")
      + (SELECT COUNT(*) FROM "LeaderboardD1SyncOutbox") AS inspected,
      (SELECT COUNT(*) FROM "PrivateD1SyncOutbox" o
        WHERE (o."key"->>'userId') IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = o."key"->>'userId'))
      + (SELECT COUNT(*) FROM "LeaderboardD1SyncOutbox" o
        WHERE NOT EXISTS (SELECT 1 FROM "LeaderboardSnapshot" s WHERE s.id = o."snapshotId")) AS impossible
  `);
  const outboxRow = outbox[0] ?? { inspected: 0n, impossible: 0n };
  checks.push({
    name: "outbox_impossible_target",
    status: count(outboxRow.impossible) ? "WARN" : "PASS",
    inspected: count(outboxRow.inspected),
    orphaned: count(outboxRow.impossible),
  });

  checks.push({
    name: "d1_projection_postgres_orphan",
    status: "UNSUPPORTED",
    inspected: 0,
    detail: "D1 has no safe local read path in this command; no remote Worker/D1 access performed.",
  });
  return { jobType: "orphans:audit", mode: "read-only", status: overall(checks), writeOperationsPerformed: 0, checks };
}

export async function runCompatibilityAudit(database: PrismaClient): Promise<{
  jobType: "compatibility:audit";
  mode: "read-only";
  status: AuditStatus;
  writeOperationsPerformed: 0;
  versions: Array<{
    name: string;
    expected: string | number | null;
    persisted: Array<string | number>;
    status: "COMPATIBLE" | "WARN" | "UNSUPPORTED";
  }>;
}> {
  type Persisted = string | number;
  const versions: Array<{
    name: string;
    expected: Persisted | null;
    persisted: Persisted[];
    status: "COMPATIBLE" | "WARN" | "UNSUPPORTED";
  }> = [];
  const add = (name: string, expected: Persisted, values: Persisted[]) => {
    const unique = [...new Set(values)];
    versions.push({
      name,
      expected,
      persisted: unique,
      status: unique.length === 0 || unique.every((value) => String(value) === String(expected))
        ? "COMPATIBLE"
        : "WARN",
    });
  };
  const addKnown = (name: string, known: Persisted[], values: Persisted[]) => {
    const unique = [...new Set(values)];
    versions.push({
      name,
      expected: "known-source-versions",
      persisted: unique,
      status: unique.every((value) => known.some((knownValue) => String(knownValue) === String(value)))
        ? "COMPATIBLE"
        : "WARN",
    });
  };
  const mastery = await database.$queryRaw<Array<{ value: string }>>(Prisma.sql`
    SELECT DISTINCT "ruleVersion" AS value FROM "LectureMastery" ORDER BY value
  `);
  add("mastery", MASTERY_RULE_VERSION, mastery.map((row) => row.value));
  const retention = await database.$queryRaw<Array<{ value: string }>>(Prisma.sql`
    SELECT DISTINCT "ruleVersion" AS value FROM "LectureRetention" ORDER BY value
  `);
  add("retention", RETENTION_RULE_VERSION, retention.map((row) => row.value));
  const ledger = await database.$queryRaw<Array<{ value: string }>>(Prisma.sql`
    SELECT DISTINCT "ruleVersion" AS value FROM "StudyPointsLedgerEntry" ORDER BY value
  `);
  addKnown("study_points_ledger", [
    LEGACY_POINTS_RULE_VERSION,
    ...STUDY_POINTS_RULE_DESCRIPTORS.map((descriptor) => descriptor.ruleVersion),
    ...STUDY_POINTS_AWARD_RULES.map((rule) => rule.ruleVersion),
  ], ledger.map((row) => row.value));
  const pointsProjection = await database.$queryRaw<Array<{ value: bigint | number }>>(Prisma.sql`
    SELECT DISTINCT "projectionVersion" AS value FROM "StudyPointsBalanceProjection" ORDER BY value
  `);
  add("study_points_projection", STUDY_POINTS_LEDGER_VERSION, pointsProjection.map((row) => count(row.value)));
  const ruleSets = await database.$queryRaw<Array<{ version: string; schemaVersion: number }>>(Prisma.sql`
    SELECT DISTINCT "version", "schemaVersion" FROM "GamificationRuleSet" ORDER BY "version"
  `);
  add("gamification_ruleset", GAMIFICATION_V1_RULE_SET_VERSION, ruleSets.map((row) => row.version));
  add("gamification_definition_schema", GAMIFICATION_DEFINITION_SCHEMA_VERSION, ruleSets.map((row) => row.schemaVersion));
  const levels = await database.$queryRaw<Array<{ value: string }>>(Prisma.sql`
    SELECT DISTINCT "ruleSetVersion" AS value FROM "UserGamificationLevel" ORDER BY value
  `);
  add("gamification_level", GAMIFICATION_V1_RULE_SET_VERSION, levels.map((row) => row.value));
  const challenges = await database.$queryRaw<Array<{ value: string }>>(Prisma.sql`
    SELECT DISTINCT "ruleSetVersion" AS value FROM "ChallengeInstance" ORDER BY value
  `);
  add("gamification_challenge", GAMIFICATION_V1_RULE_SET_VERSION, challenges.map((row) => row.value));
  const leaderboard = await database.$queryRaw<Array<{ value: string }>>(Prisma.sql`
    SELECT DISTINCT "rankingSemanticsVersion" AS value FROM "LeaderboardSnapshot" ORDER BY value
  `);
  add("leaderboard_ranking", LEADERBOARD_CACHE_RANKING_VERSION, leaderboard.map((row) => row.value));
  versions.push(
    {
      name: "private_d1_schema",
      expected: null,
      persisted: [],
      status: "UNSUPPORTED",
    },
    {
      name: "leaderboard_d1_schema",
      expected: null,
      persisted: [],
      status: "UNSUPPORTED",
    },
    {
      name: "ai_schema_or_prompt_cache",
      expected: null,
      persisted: [],
      status: "UNSUPPORTED",
    },
  );
  return {
    jobType: "compatibility:audit",
    mode: "read-only",
    status: versions.some((item) => item.status === "UNSUPPORTED")
      ? "UNSUPPORTED"
      : versions.some((item) => item.status === "WARN") ? "WARN" : "PASS",
    writeOperationsPerformed: 0,
    versions,
  };
}