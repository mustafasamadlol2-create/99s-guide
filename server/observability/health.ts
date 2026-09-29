import { Prisma, type PrismaClient } from "@prisma/client";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { getStudyFeatureFlags } from "../features/study-core/featureFlags.js";
import { getPrisma } from "../services/prismaClient.js";
import { readOutboxStatus } from "../study-maintenance/jobs/outbox.js";
import { getOperationalMetricsSnapshot } from "./metrics.js";
import type {
  HealthComponent,
  HealthStatus,
  RouteFamily,
  SystemHealthSnapshot,
} from "./types.js";

const CACHE_TTL_MS = 30_000;
const MAX_STALE_MS = 120_000;
const REQUIRED_TABLES = [
  "User",
  "StudyEvent",
  "FocusSession",
  "GroupFocusRoom",
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

type HealthDatabase = Pick<PrismaClient, "$queryRaw">;

let cachedSnapshot: SystemHealthSnapshot | null = null;
let cachedAt = 0;
let refreshInFlight: Promise<SystemHealthSnapshot> | null = null;

function checkedAt(now: number): string {
  return new Date(now).toISOString();
}

function environmentName(): SystemHealthSnapshot["environment"] {
  if (process.env.NODE_ENV === "production") return "production";
  if (process.env.NODE_ENV === "test") return "test";
  if (process.env.NODE_ENV === "development") return "development";
  return "unknown";
}

function emptyComponent(
  status: HealthStatus,
  enabled: boolean | null,
  now: number,
  summary: HealthComponent["summary"] = {},
): HealthComponent {
  return { status, enabled, checkedAt: checkedAt(now), summary };
}

function metricForFamily(
  family: RouteFamily,
  metrics: ReturnType<typeof getOperationalMetricsSnapshot>,
) {
  return metrics.byFeature.find((entry) => entry.feature === family);
}

function requestComponent(input: {
  enabled: boolean;
  family: RouteFamily;
  now: number;
  metrics: ReturnType<typeof getOperationalMetricsSnapshot>;
}): HealthComponent {
  if (!input.enabled) {
    return emptyComponent("UNKNOWN", false, input.now, { featureState: "DISABLED" });
  }
  const observed = metricForFamily(input.family, input.metrics);
  if (!observed || observed.requests === 0) {
    return emptyComponent("UNKNOWN", true, input.now, {
      featureState: "ENABLED",
      requestSignal: "NO_RECENT_REQUESTS",
    });
  }
  return emptyComponent(
    observed.serverErrors > 0 ? "DEGRADED" : "HEALTHY",
    true,
    input.now,
    {
      featureState: "ENABLED",
      requests15m: observed.requests,
      serverErrors15m: observed.serverErrors,
      p95LatencyMs: observed.p95Ms,
    },
  );
}

function statusForOutbox(
  item: Awaited<ReturnType<typeof readOutboxStatus>>[number] | undefined,
  now: number,
): HealthComponent {
  if (!item) return emptyComponent("UNKNOWN", null, now, { query: "UNAVAILABLE" });
  const pendingAgeMs = item.oldestPendingAt === null
    ? null
    : Math.max(0, now - Date.parse(item.oldestPendingAt));
  const configuredMaxAge = Number.parseInt(
    process.env.STUDY_OUTBOX_MAX_PENDING_AGE_MS ?? "",
    10,
  );
  const ageThresholdMs = Number.isInteger(configuredMaxAge) && configuredMaxAge > 0
    ? configuredMaxAge
    : null;
  const ageExceeded = ageThresholdMs !== null && pendingAgeMs !== null
    && pendingAgeMs > ageThresholdMs;
  const degraded = item.blocked > 0 || item.poison > 0 || item.highAttempts > 0 || ageExceeded;
  return emptyComponent(degraded ? "DEGRADED" : "HEALTHY", true, now, {
    kind: item.kind,
    pending: item.pending,
    delayed: item.delayed,
    leased: item.leased,
    blocked: item.blocked,
    poison: item.poison,
    highAttempts: item.highAttempts,
    pendingAgeMs,
    ageThresholdConfigured: ageThresholdMs !== null,
    maxAttemptsObserved: item.maxAttempts,
  });
}

function combineStatuses(statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes("UNHEALTHY")) return "UNHEALTHY";
  if (statuses.includes("DEGRADED")) return "DEGRADED";
  if (statuses.includes("UNKNOWN")) return "UNKNOWN";
  return "HEALTHY";
}

function overallStatus(snapshot: SystemHealthSnapshot): HealthStatus {
  const required = [snapshot.components.postgres, snapshot.components.outbox];
  const enabledOptional = Object.values(snapshot.components)
    .filter((component) => component.enabled === true);
  return combineStatuses([...required, ...enabledOptional].map((item) => item.status));
}

function buildBase(): Omit<SystemHealthSnapshot, "checkedAt" | "freshness" | "overall" | "components" | "featureFlags" | "operations"> {
  return {
    version: "study-system-health-v1",
    environment: environmentName(),
    build: {
      version: process.env.APP_VERSION?.slice(0, 80)
        || process.env.npm_package_version?.slice(0, 80)
        || "unknown",
      commit: process.env.GIT_COMMIT_SHA?.match(/^[a-f0-9]{7,40}$/iu)?.[0] ?? null,
    },
    release: {
      command: "npm run study:release-check -- --target=local",
      mode: "manual-cli",
      note: "Runtime health is separate from the read-only local/staging release check.",
    },
  };
}

async function readPostgresHealth(database: HealthDatabase, now: number) {
  const startedAt = Date.now();
  try {
    const connectivity = await database.$queryRaw<Array<{ ok: number }>>(
      Prisma.sql`SELECT 1::int AS ok`,
    );
    const latencyMs = Math.max(0, Date.now() - startedAt);
    if (connectivity[0]?.ok !== 1) {
      return {
        component: emptyComponent("UNHEALTHY", true, now, {
          connectivity: "FAILED",
          latencyMs,
        }),
        schema: "UNKNOWN" as const,
      };
    }

    const tableRows = await database.$queryRaw<Array<{ table_name: string }>>(Prisma.sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    const present = new Set(tableRows.map((row) => row.table_name));
    const missingTables = REQUIRED_TABLES.filter((table) => !present.has(table));
    let migrationStatus: "CURRENT" | "PENDING" | "UNKNOWN" = "UNKNOWN";
    let localMigrationCount: number | null = null;
    if (present.has("_prisma_migrations")) {
      const [migrationCounts] = await database.$queryRaw<Array<{
        applied: bigint;
        unresolved: bigint;
      }>>(Prisma.sql`
        SELECT
          COUNT(*) FILTER (
            WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
          )::bigint AS applied,
          COUNT(*) FILTER (
            WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL
          )::bigint AS unresolved
        FROM "_prisma_migrations"
      `);
      try {
        const local = await readdir(join(process.cwd(), "prisma", "migrations"), {
          withFileTypes: true,
        });
        localMigrationCount = local.filter((entry) => entry.isDirectory()).length;
        migrationStatus = Number(migrationCounts?.unresolved ?? 0) > 0
          || Number(migrationCounts?.applied ?? 0) < localMigrationCount
          ? "PENDING"
          : "CURRENT";
      } catch {
        migrationStatus = "UNKNOWN";
      }
    }

    const schemaStatus = missingTables.length > 0
      ? "UNHEALTHY"
      : migrationStatus === "PENDING"
        ? "DEGRADED"
        : migrationStatus === "UNKNOWN"
          ? "UNKNOWN"
          : "HEALTHY";
    const componentStatus = combineStatuses(["HEALTHY", schemaStatus]);
    return {
      component: emptyComponent(componentStatus, true, now, {
        connectivity: "HEALTHY",
        latencyMs,
        schemaStatus,
        missingCriticalTableCount: missingTables.length,
        localMigrationCount,
      }),
      schema: schemaStatus,
    };
  } catch {
    return {
      component: emptyComponent("UNHEALTHY", true, now, {
        connectivity: "FAILED",
        latencyMs: Math.max(0, Date.now() - startedAt),
      }),
      schema: "UNHEALTHY" as const,
    };
  }
}

async function readGroupFocusHealth(database: HealthDatabase, now: number) {
  try {
    const [roomRows, lagRows] = await Promise.all([
      database.$queryRaw<Array<{ status: string; count: bigint }>>(Prisma.sql`
        SELECT "status", COUNT(*)::bigint AS count
        FROM "GroupFocusRoom"
        GROUP BY "status"
      `),
      database.$queryRaw<Array<{ summaries: bigint; p95_lag_ms: number | null; max_lag_ms: number | null }>>(Prisma.sql`
        SELECT
          COUNT(*)::bigint AS summaries,
          percentile_cont(0.95) WITHIN GROUP (
            ORDER BY GREATEST(0, EXTRACT(EPOCH FROM ("createdAt" - "runtimeEndedAt")) * 1000)
          ) AS p95_lag_ms,
          MAX(GREATEST(0, EXTRACT(EPOCH FROM ("createdAt" - "runtimeEndedAt")) * 1000))
            AS max_lag_ms
        FROM "GroupFocusRun"
        WHERE "runtimeEndedAt" >= NOW() - INTERVAL '7 days'
      `),
    ]);
    const openRooms = roomRows
      .filter((row) => row.status === "OPEN")
      .reduce((sum, row) => sum + Number(row.count), 0);
    const closedRooms = roomRows
      .filter((row) => row.status === "CLOSED")
      .reduce((sum, row) => sum + Number(row.count), 0);
    const lag = lagRows[0];
    return emptyComponent("UNKNOWN", true, now, {
      apiRuntime: "OBSERVED_BY_REQUEST_METRICS",
      durableObjectRuntime: "NOT_DIRECTLY_PROBED",
      openRooms,
      closedRooms,
      reconciledSummaries7d: Number(lag?.summaries ?? 0),
      reconciliationP95Ms: lag?.p95_lag_ms === null || lag?.p95_lag_ms === undefined
        ? null
        : Math.round(Number(lag.p95_lag_ms)),
      reconciliationMaxMs: lag?.max_lag_ms === null || lag?.max_lag_ms === undefined
        ? null
        : Math.round(Number(lag.max_lag_ms)),
    });
  } catch {
    return emptyComponent("UNKNOWN", true, now, { aggregateQuery: "UNAVAILABLE" });
  }
}

async function computeSnapshot(
  database: HealthDatabase,
  now: number,
): Promise<SystemHealthSnapshot> {
  const flags = getStudyFeatureFlags();
  const metrics = getOperationalMetricsSnapshot(now);
  const base = buildBase();
  const postgres = await readPostgresHealth(database, now);

  let outboxes: Awaited<ReturnType<typeof readOutboxStatus>> | null = null;
  if (postgres.component.status !== "UNHEALTHY") {
    try {
      outboxes = await readOutboxStatus(database as PrismaClient);
    } catch {
      outboxes = null;
    }
  }
  const privateOutbox = outboxes?.find((row) => row.kind === "private");
  const leaderboardOutbox = outboxes?.find((row) => row.kind === "leaderboard");
  const privateD1Enabled = Boolean(
    process.env.PRIVATE_D1_WRITE_MIRROR_ENABLED
    && /^(1|true|yes|on)$/iu.test(process.env.PRIVATE_D1_WRITE_MIRROR_ENABLED),
  ) || flags.MASTERY_ENABLED;
  const leaderboardD1Enabled =
    flags.LEADERBOARD_D1_PROJECTION_ENABLED || flags.LEADERBOARD_D1_READ_ENABLED;
  const groupEnabled = flags.GROUP_FOCUS_ENABLED;
  const privateWorkerConfigured = Boolean(
    process.env.PRIVATE_DATA_WORKER_BASE_URL && process.env.PRIVATE_DATA_SYNC_SECRET,
  );

  const privateD1 = !privateD1Enabled
    ? emptyComponent("UNKNOWN", false, now, { featureState: "DISABLED" })
    : privateOutbox
      ? emptyComponent(
        privateOutbox.blocked > 0 || privateOutbox.poison > 0 || privateOutbox.highAttempts > 0
          ? "DEGRADED"
          : "UNKNOWN",
        true,
        now,
        {
          workerConfigured: privateWorkerConfigured,
          workerReachability: "NOT_DIRECTLY_PROBED",
          pending: privateOutbox.pending,
          delayed: privateOutbox.delayed,
          blocked: privateOutbox.blocked,
          poison: privateOutbox.poison,
          highAttempts: privateOutbox.highAttempts,
          oldestPendingAt: privateOutbox.oldestPendingAt,
          projectionTypeCount: null,
        },
      )
      : emptyComponent("UNKNOWN", true, now, { outbox: "UNAVAILABLE" });

  const leaderboardD1 = !leaderboardD1Enabled
    ? emptyComponent("UNKNOWN", false, now, { featureState: "DISABLED" })
    : leaderboardOutbox
      ? emptyComponent(
        leaderboardOutbox.blocked > 0 || leaderboardOutbox.poison > 0
          || leaderboardOutbox.highAttempts > 0
          ? "DEGRADED"
          : "UNKNOWN",
        true,
        now,
        {
          workerReachability: "NOT_DIRECTLY_PROBED",
          postgresFallback: "CANONICAL",
          pending: leaderboardOutbox.pending,
          delayed: leaderboardOutbox.delayed,
          blocked: leaderboardOutbox.blocked,
          poison: leaderboardOutbox.poison,
          highAttempts: leaderboardOutbox.highAttempts,
          oldestPendingAt: leaderboardOutbox.oldestPendingAt,
        },
      )
      : emptyComponent("UNKNOWN", true, now, { outbox: "UNAVAILABLE" });

  const groupFocus = groupEnabled
    ? await readGroupFocusHealth(database, now)
    : emptyComponent("UNKNOWN", false, now, { featureState: "DISABLED" });
  const components: SystemHealthSnapshot["components"] = {
    postgres: postgres.component,
    outbox: outboxes
      ? combineStatuses([
        statusForOutbox(privateOutbox, now).status,
        statusForOutbox(leaderboardOutbox, now).status,
      ]) === "HEALTHY"
        ? emptyComponent("HEALTHY", true, now, {
          privatePending: privateOutbox?.pending ?? null,
          leaderboardPending: leaderboardOutbox?.pending ?? null,
          oldestPendingAgeMs: Math.max(
            0,
            ...outboxes.map((row) =>
              row.oldestPendingAt ? now - Date.parse(row.oldestPendingAt) : 0),
          ),
        })
        : emptyComponent(
          combineStatuses([
            statusForOutbox(privateOutbox, now).status,
            statusForOutbox(leaderboardOutbox, now).status,
          ]),
          true,
          now,
          {
            privatePending: privateOutbox?.pending ?? null,
            privateBlocked: privateOutbox?.blocked ?? null,
            privatePoison: privateOutbox?.poison ?? null,
            leaderboardPending: leaderboardOutbox?.pending ?? null,
            leaderboardBlocked: leaderboardOutbox?.blocked ?? null,
            leaderboardPoison: leaderboardOutbox?.poison ?? null,
          },
        )
      : emptyComponent("UNKNOWN", true, now, { query: "UNAVAILABLE" }),
    privateD1,
    leaderboardD1,
    groupFocus,
    studyPoints: requestComponent({
      enabled: flags.STUDY_POINTS_ENABLED,
      family: "STUDY_POINTS",
      now,
      metrics,
    }),
    recall: requestComponent({
      enabled: flags.SPACED_RECALL_ENABLED,
      family: "RECALL",
      now,
      metrics,
    }),
    masteryRetention: requestComponent({
      enabled: flags.MASTERY_ENABLED,
      family: "MASTERY",
      now,
      metrics,
    }),
    analyzer: requestComponent({
      enabled: flags.STUDY_ANALYZER_ENABLED,
      family: "ANALYZER",
      now,
      metrics,
    }),
    workersAi: requestComponent({
      enabled: flags.AI_STUDY_INSIGHTS_ENABLED,
      family: "STUDY_INSIGHTS",
      now,
      metrics,
    }),
    askStudyData: requestComponent({
      enabled: flags.ASK_MY_STUDY_DATA_ENABLED,
      family: "ASK_STUDY_DATA",
      now,
      metrics,
    }),
  };

  const snapshot: SystemHealthSnapshot = {
    ...base,
    checkedAt: checkedAt(now),
    freshness: "FRESH",
    overall: "UNKNOWN",
    components,
    featureFlags: flags,
    operations: {
      windowMinutes: metrics.windowMinutes,
      requests: metrics.requests,
      successes: metrics.successes,
      clientErrors: metrics.clientErrors,
      serverErrors: metrics.serverErrors,
      serverErrorRate: metrics.serverErrorRate,
      latencyMs: metrics.latencyMs,
      byFeature: metrics.byFeature,
      outcomes: metrics.outcomes,
      recentErrors: metrics.recentErrors,
    },
  };
  snapshot.overall = overallStatus(snapshot);
  return snapshot;
}

function staleSnapshot(now: number): SystemHealthSnapshot {
  const base = cachedSnapshot!;
  const components = Object.fromEntries(
    Object.entries(base.components).map(([key, component]) => [
      key,
      emptyComponent(
        "UNKNOWN",
        component.enabled,
        now,
        { dataQuality: "STALE", previouslyObservedStatus: component.status },
      ),
    ]),
  ) as SystemHealthSnapshot["components"];
  return {
    ...base,
    checkedAt: checkedAt(now),
    freshness: "STALE",
    overall: "UNKNOWN",
    components,
    operations: {
      ...base.operations,
      recentErrors: base.operations.recentErrors.slice(0, 20),
    },
  };
}

export async function getStudyEngineHealth(options: {
  database?: HealthDatabase;
  forceRefresh?: boolean;
  now?: number;
} = {}): Promise<SystemHealthSnapshot> {
  const now = options.now ?? Date.now();
  if (!options.forceRefresh && cachedSnapshot && now - cachedAt < CACHE_TTL_MS) {
    return { ...cachedSnapshot, freshness: "CACHED" };
  }
  if (refreshInFlight) return refreshInFlight;

  const database = options.database ?? getPrisma();
  refreshInFlight = computeSnapshot(database, now)
    .then((snapshot) => {
      cachedSnapshot = snapshot;
      cachedAt = now;
      return snapshot;
    })
    .catch(() => {
      if (cachedSnapshot && now - cachedAt <= MAX_STALE_MS) return staleSnapshot(now);
      const base = buildBase();
      const components = Object.fromEntries(
        [
          "postgres",
          "outbox",
          "privateD1",
          "leaderboardD1",
          "groupFocus",
          "studyPoints",
          "recall",
          "masteryRetention",
          "analyzer",
          "workersAi",
          "askStudyData",
        ].map((name) => [name, emptyComponent("UNKNOWN", null, now, { dataQuality: "UNAVAILABLE" })]),
      ) as SystemHealthSnapshot["components"];
      const metrics = getOperationalMetricsSnapshot(now);
      return {
        ...base,
        checkedAt: checkedAt(now),
        freshness: "STALE",
        overall: "UNKNOWN",
        components,
        featureFlags: getStudyFeatureFlags(),
        operations: {
          windowMinutes: metrics.windowMinutes,
          requests: metrics.requests,
          successes: metrics.successes,
          clientErrors: metrics.clientErrors,
          serverErrors: metrics.serverErrors,
          serverErrorRate: metrics.serverErrorRate,
          latencyMs: metrics.latencyMs,
          byFeature: metrics.byFeature,
          outcomes: metrics.outcomes,
          recentErrors: metrics.recentErrors,
        },
      } satisfies SystemHealthSnapshot;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export function clearStudyEngineHealthCacheForTests(): void {
  cachedSnapshot = null;
  cachedAt = 0;
  refreshInFlight = null;
}