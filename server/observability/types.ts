export const HEALTH_STATUSES = [
  "HEALTHY",
  "DEGRADED",
  "UNHEALTHY",
  "UNKNOWN",
] as const;

export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const ROUTE_FAMILIES = [
  "FOCUS",
  "GROUP_FOCUS",
  "RECALL",
  "STUDY_POINTS",
  "MASTERY",
  "RETENTION",
  "LEADERBOARD",
  "ANALYZER",
  "STUDY_INSIGHTS",
  "ASK_STUDY_DATA",
  "OWNER_ANALYTICS",
  "GENERAL",
] as const;

export type RouteFamily = (typeof ROUTE_FAMILIES)[number];

export const OPERATIONAL_ERROR_CODES = [
  "HTTP_5XX",
  "CLIENT_RENDER_ERROR",
  "CLIENT_RUNTIME_ERROR",
  "DB_CONNECTION_ERROR",
  "DB_QUERY_ERROR",
  "STUDY_POINTS_LEDGER_INVARIANT",
  "STUDY_OUTBOX_DELIVERY_FAILED",
  "STUDY_D1_PROJECTION_STALE",
  "STUDY_GROUP_RUNTIME_UNAVAILABLE",
  "STUDY_RECALL_ANSWER_FAILED",
  "STUDY_MASTERY_REBUILD_FAILED",
  "STUDY_AI_PROVIDER_UNAVAILABLE",
  "OTHER",
] as const;

export type OperationalErrorCode = (typeof OPERATIONAL_ERROR_CODES)[number];

export interface HealthComponent {
  status: HealthStatus;
  enabled: boolean | null;
  checkedAt: string;
  summary: Record<string, string | number | boolean | null>;
}

export interface SystemHealthSnapshot {
  version: "study-system-health-v1";
  checkedAt: string;
  freshness: "FRESH" | "CACHED" | "STALE";
  overall: HealthStatus;
  environment: "development" | "test" | "production" | "unknown";
  build: {
    version: string;
    commit: string | null;
  };
  components: {
    postgres: HealthComponent;
    outbox: HealthComponent;
    privateD1: HealthComponent;
    leaderboardD1: HealthComponent;
    groupFocus: HealthComponent;
    studyPoints: HealthComponent;
    recall: HealthComponent;
    masteryRetention: HealthComponent;
    analyzer: HealthComponent;
    workersAi: HealthComponent;
    askStudyData: HealthComponent;
  };
  featureFlags: Record<string, boolean>;
  operations: {
    windowMinutes: number;
    requests: number;
    successes: number;
    clientErrors: number;
    serverErrors: number;
    serverErrorRate: number | null;
    latencyMs: { p50: number | null; p95: number | null; p99: number | null };
    byFeature: Array<{
      feature: RouteFamily;
      requests: number;
      successes: number;
      clientErrors: number;
      serverErrors: number;
      p95Ms: number | null;
    }>;
    outcomes: Array<{
      feature: string;
      operation: string;
      result: string;
      count: number;
    }>;
    recentErrors: Array<{
      service: string;
      feature: string;
      errorCode: OperationalErrorCode;
      count: number;
      lastOccurredAt: string;
    }>;
  };
  release: {
    command: "npm run study:release-check -- --target=local";
    mode: "manual-cli";
    note: string;
  };
}

export type ReleaseGateStatus = "PASS" | "WARN" | "FAIL" | "SKIP";

export interface ReleaseGateResult {
  gate: string;
  status: ReleaseGateStatus;
  code: string;
  message: string;
}

export interface ReleaseCheckReport {
  version: "study-release-check-v1";
  target: "local" | "staging";
  checkedAt: string;
  mode: "fast" | "deep";
  status: "READY" | "READY_WITH_WARNINGS" | "NOT_READY";
  writeOperationsPerformed: 0;
  gates: ReleaseGateResult[];
}