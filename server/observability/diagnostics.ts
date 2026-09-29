import type { PrismaClient } from "@prisma/client";
import { getStudyFeatureFlags } from "../features/study-core/featureFlags.js";
import { getOperationalMetricsSnapshot } from "./metrics.js";
import { getStudyEngineHealth } from "./health.js";

export interface IncidentDiagnostics {
  version: "study-incident-diagnostics-v1";
  mode: "read-only";
  writeOperationsPerformed: 0;
  target: "local" | "staging";
  generatedAt: string;
  health: Awaited<ReturnType<typeof getStudyEngineHealth>>;
  configuration: {
    featureFlags: Record<string, boolean>;
    privateD1WorkerConfigured: boolean;
    groupFocusWorkerConfigured: boolean;
    sessionAuthenticationConfigured: boolean;
  };
}

export async function collectIncidentDiagnostics(input: {
  target: "local" | "staging";
  database?: PrismaClient;
  now?: number;
}): Promise<IncidentDiagnostics> {
  const now = input.now ?? Date.now();
  const unavailableDatabase = {
    $queryRaw: async () => {
      throw new Error("DATABASE_NOT_SELECTED");
    },
  } as unknown as PrismaClient;
  const health = await getStudyEngineHealth({
    database: input.database ?? unavailableDatabase,
    forceRefresh: true,
    now,
  });
  // A diagnostic run without an explicitly selected target database must not
  // fall through to the application's default Prisma connection.
  const safeHealth = input.database
    ? health
    : {
      ...health,
      overall: "UNKNOWN" as const,
      freshness: "STALE" as const,
      components: Object.fromEntries(
        Object.entries(health.components).map(([key, component]) => [
          key,
          {
            ...component,
            status: "UNKNOWN" as const,
            summary: { dataQuality: "DATABASE_NOT_SELECTED" },
          },
        ]),
      ) as unknown as typeof health.components,
    };
  const metrics = getOperationalMetricsSnapshot(now);
  return {
    version: "study-incident-diagnostics-v1",
    mode: "read-only",
    writeOperationsPerformed: 0,
    target: input.target,
    generatedAt: new Date(now).toISOString(),
    health: {
      ...safeHealth,
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
    },
    configuration: {
      featureFlags: getStudyFeatureFlags(),
      privateD1WorkerConfigured: Boolean(
        process.env.PRIVATE_DATA_WORKER_BASE_URL
        && process.env.PRIVATE_DATA_SYNC_SECRET,
      ),
      groupFocusWorkerConfigured: Boolean(
        process.env.GROUP_FOCUS_WORKER_URL
        || process.env.VITE_GROUP_FOCUS_WORKER_URL,
      ),
      sessionAuthenticationConfigured: Boolean(
        process.env.SESSION_SECRET || process.env.JWT_SECRET,
      ),
    },
  };
}