import {
  OPERATIONAL_ERROR_CODES,
  ROUTE_FAMILIES,
  type OperationalErrorCode,
  type RouteFamily,
} from "./types.js";

const WINDOW_MINUTES = 15;
const MAX_BUCKETS = WINDOW_MINUTES;
const DURATION_BUCKETS = [10, 50, 100, 250, 500, 1_000, 2_000, 5_000, 10_000] as const;
const routeFamilySet = new Set<string>(ROUTE_FAMILIES);
const errorCodeSet = new Set<string>(OPERATIONAL_ERROR_CODES);

type RequestCounts = {
  requests: number;
  successes: number;
  clientErrors: number;
  serverErrors: number;
  durationCounts: number[];
  maxDurationMs: number;
};

type ErrorCounts = {
  service: "api" | "postgres" | "worker" | "frontend" | "study_engine";
  feature: string;
  errorCode: OperationalErrorCode;
  count: number;
  lastOccurredAt: number;
};

type OperationCounts = {
  feature: string;
  operation: string;
  result: string;
  count: number;
};

const OPERATION_FEATURES = [
  "private_d1",
  "leaderboard_d1",
  "group_focus",
  "study_points",
  "recall",
  "mastery",
  "retention",
  "analyzer",
  "ai_insights",
  "ask_study_data",
  "database",
  "frontend",
] as const;
const operationFeatureSet = new Set<string>(OPERATION_FEATURES);

type MinuteBucket = {
  minute: number;
  routes: Map<RouteFamily, RequestCounts>;
  errors: Map<string, ErrorCounts>;
  operations: Map<string, OperationCounts>;
};

const buckets: Array<MinuteBucket | null> = Array.from({ length: MAX_BUCKETS }, () => null);

function safeBucket(now: number): MinuteBucket {
  const minute = Math.floor(now / 60_000);
  const index = ((minute % MAX_BUCKETS) + MAX_BUCKETS) % MAX_BUCKETS;
  let bucket = buckets[index];
  if (!bucket || bucket.minute !== minute) {
    bucket = { minute, routes: new Map(), errors: new Map(), operations: new Map() };
    buckets[index] = bucket;
  }
  return bucket;
}

function normalizeRouteFamily(value: string): RouteFamily {
  return routeFamilySet.has(value) ? value as RouteFamily : "GENERAL";
}

function normalizeErrorCode(value: string | undefined): OperationalErrorCode {
  if (!value) return "OTHER";
  return errorCodeSet.has(value) ? value as OperationalErrorCode : "OTHER";
}

function normalizeFeature(value: string): string {
  if (routeFamilySet.has(value)) return value;
  if (operationFeatureSet.has(value)) return value;
  return "OTHER";
}

function getRequestCounts(bucket: MinuteBucket, family: RouteFamily): RequestCounts {
  let counts = bucket.routes.get(family);
  if (!counts) {
    counts = {
      requests: 0,
      successes: 0,
      clientErrors: 0,
      serverErrors: 0,
      durationCounts: Array.from({ length: DURATION_BUCKETS.length + 1 }, () => 0),
      maxDurationMs: 0,
    };
    bucket.routes.set(family, counts);
  }
  return counts;
}

function addError(
  bucket: MinuteBucket,
  input: {
    service: ErrorCounts["service"];
    feature: string;
    errorCode: string | undefined;
    now: number;
  },
): void {
  const code = normalizeErrorCode(input.errorCode);
  const feature = normalizeFeature(input.feature);
  const key = `${input.service}:${feature}:${code}`;
  const current = bucket.errors.get(key);
  if (current) {
    current.count += 1;
    current.lastOccurredAt = Math.max(current.lastOccurredAt, input.now);
  } else {
    bucket.errors.set(key, {
      service: input.service,
      feature,
      errorCode: code,
      count: 1,
      lastOccurredAt: input.now,
    });
  }
}

export function routeFamilyForPath(path: string): RouteFamily {
  if (/^\/api\/focus(?:\/|$)/u.test(path)) return "FOCUS";
  if (/^\/api\/group-focus(?:\/|$)/u.test(path) ||
      /^\/api\/internal\/group-focus(?:\/|$)/u.test(path)) return "GROUP_FOCUS";
  if (/^\/api\/recall(?:\/|$)/u.test(path)) return "RECALL";
  if (/^\/api\/(?:admin\/)?study-points(?:\/|$)/u.test(path)) return "STUDY_POINTS";
  if (/^\/api\/me\/mastery(?:\/|$)/u.test(path)) return "MASTERY";
  if (/^\/api\/me\/retention(?:\/|$)/u.test(path)) return "RETENTION";
  if (/^\/api\/(?:admin\/)?leaderboards?(?:\/|$)/u.test(path)) return "LEADERBOARD";
  if (/^\/api\/me\/study-analyzer(?:\/|$)/u.test(path)) return "ANALYZER";
  if (/^\/api\/me\/study-insights(?:\/|$)/u.test(path)) return "STUDY_INSIGHTS";
  if (/^\/api\/me\/study-data\/ask(?:\/|$)/u.test(path)) return "ASK_STUDY_DATA";
  if (/^\/api\/admin\/owner-analytics(?:\/|$)/u.test(path)) return "OWNER_ANALYTICS";
  return "GENERAL";
}

export function recordHttpRequest(input: {
  routeFamily: string;
  statusCode: number;
  durationMs: number;
  at?: number;
}): void {
  try {
    const now = Number.isFinite(input.at) ? input.at! : Date.now();
    const bucket = safeBucket(now);
    const family = normalizeRouteFamily(input.routeFamily);
    const counts = getRequestCounts(bucket, family);
    const duration = Math.max(0, Math.min(60_000, Math.round(input.durationMs)));
    const durationIndex = DURATION_BUCKETS.findIndex((upperBound) => duration <= upperBound);
    counts.durationCounts[durationIndex < 0 ? DURATION_BUCKETS.length : durationIndex] += 1;
    counts.maxDurationMs = Math.max(counts.maxDurationMs, duration);
    counts.requests += 1;
    if (input.statusCode >= 500) {
      counts.serverErrors += 1;
      addError(bucket, { service: "api", feature: family, errorCode: "HTTP_5XX", now });
    } else if (input.statusCode >= 400) {
      counts.clientErrors += 1;
    } else if (input.statusCode >= 200 && input.statusCode < 400) {
      counts.successes += 1;
    }
  } catch {
    // Telemetry must never affect the request being observed.
  }
}

export function recordOperationalOutcome(input: {
  feature:
    | "private_d1"
    | "leaderboard_d1"
    | "group_focus"
    | "study_points"
    | "recall"
    | "mastery"
    | "retention"
    | "analyzer"
    | "ai_insights"
    | "ask_study_data"
    | "frontend"
    | "database";
  operation: "deliver" | "fallback" | "recompute" | "provider" | "request" | "reconcile";
  result:
    | "success"
    | "failure"
    | "duplicate"
    | "cap_limited"
    | "no_eligible"
    | "cooldown"
    | "fallback"
    | "timeout"
    | "unavailable"
    | "validation_failure"
    | "insufficient_data"
    | "cache_hit"
    | "cache_miss"
    | "unsupported"
    | "skipped";
  errorCode?: string;
  at?: number;
}): void {
  try {
    const now = Number.isFinite(input.at) ? input.at! : Date.now();
    const bucket = safeBucket(now);
    const key = `${input.feature}:${input.operation}:${input.result}`;
    const existing = bucket.operations.get(key);
    if (existing) existing.count += 1;
    else {
      bucket.operations.set(key, {
        feature: input.feature,
        operation: input.operation,
        result: input.result,
        count: 1,
      });
    }
    if (input.result === "failure" || input.result === "timeout" || input.result === "unavailable") {
      addError(bucket, {
        service: input.feature === "database"
          ? "postgres"
          : input.feature === "frontend" ? "frontend" : "study_engine",
        feature: input.feature,
        errorCode: input.errorCode,
        now,
      });
    }
  } catch {
    // Best-effort, in-memory telemetry is deliberately non-blocking.
  }
}

function isInWindow(bucket: MinuteBucket | null, currentMinute: number): bucket is MinuteBucket {
  return Boolean(bucket && bucket.minute <= currentMinute && bucket.minute > currentMinute - WINDOW_MINUTES);
}

function percentileFromHistogram(
  counts: number[],
  percentile: number,
): number | null {
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total === 0) return null;
  const target = Math.max(1, Math.ceil(total * percentile));
  let seen = 0;
  for (let index = 0; index < counts.length; index += 1) {
    seen += counts[index] ?? 0;
    if (seen >= target) {
      return index < DURATION_BUCKETS.length
        ? DURATION_BUCKETS[index] ?? null
        : 60_000;
    }
  }
  return 60_000;
}

export function getOperationalMetricsSnapshot(now = Date.now()) {
  const currentMinute = Math.floor(now / 60_000);
  const active = buckets.filter((bucket) => isInWindow(bucket, currentMinute));
  const totalHistogram = Array.from({ length: DURATION_BUCKETS.length + 1 }, () => 0);
  const routeTotals = new Map<RouteFamily, RequestCounts>();
  const errorTotals = new Map<string, ErrorCounts>();
  const operationTotals = new Map<string, OperationCounts>();

  for (const bucket of active) {
    for (const [family, counts] of bucket.routes) {
      let target = routeTotals.get(family);
      if (!target) {
        target = {
          requests: 0,
          successes: 0,
          clientErrors: 0,
          serverErrors: 0,
          durationCounts: Array.from({ length: DURATION_BUCKETS.length + 1 }, () => 0),
          maxDurationMs: 0,
        };
        routeTotals.set(family, target);
      }
      target.requests += counts.requests;
      target.successes += counts.successes;
      target.clientErrors += counts.clientErrors;
      target.serverErrors += counts.serverErrors;
      target.maxDurationMs = Math.max(target.maxDurationMs, counts.maxDurationMs);
      counts.durationCounts.forEach((count, index) => {
        target!.durationCounts[index] = (target!.durationCounts[index] ?? 0) + count;
        totalHistogram[index] = (totalHistogram[index] ?? 0) + count;
      });
    }
    for (const [key, error] of bucket.errors) {
      const existing = errorTotals.get(key);
      if (existing) {
        existing.count += error.count;
        existing.lastOccurredAt = Math.max(existing.lastOccurredAt, error.lastOccurredAt);
      } else errorTotals.set(key, { ...error });
    }
    for (const [key, operation] of bucket.operations) {
      const existing = operationTotals.get(key);
      if (existing) existing.count += operation.count;
      else operationTotals.set(key, { ...operation });
    }
  }

  const byFeature = [...routeTotals.entries()]
    .map(([feature, counts]) => ({
      feature,
      requests: counts.requests,
      successes: counts.successes,
      clientErrors: counts.clientErrors,
      serverErrors: counts.serverErrors,
      p95Ms: percentileFromHistogram(counts.durationCounts, 0.95),
    }))
    .sort((left, right) => left.feature.localeCompare(right.feature));
  const requests = byFeature.reduce((sum, item) => sum + item.requests, 0);
  const successes = byFeature.reduce((sum, item) => sum + item.successes, 0);
  const clientErrors = byFeature.reduce((sum, item) => sum + item.clientErrors, 0);
  const serverErrors = byFeature.reduce((sum, item) => sum + item.serverErrors, 0);

  return {
    windowMinutes: WINDOW_MINUTES,
    requests,
    successes,
    clientErrors,
    serverErrors,
    serverErrorRate: requests === 0 ? null : serverErrors / requests,
    latencyMs: {
      p50: percentileFromHistogram(totalHistogram, 0.5),
      p95: percentileFromHistogram(totalHistogram, 0.95),
      p99: percentileFromHistogram(totalHistogram, 0.99),
    },
    byFeature,
    recentErrors: [...errorTotals.values()]
      .sort((left, right) => right.lastOccurredAt - left.lastOccurredAt)
      .slice(0, 20)
      .map((error) => ({
        service: error.service,
        feature: error.feature,
        errorCode: error.errorCode,
        count: error.count,
        lastOccurredAt: new Date(error.lastOccurredAt).toISOString(),
      })),
    outcomes: [...operationTotals.values()]
      .map(({ feature, operation, result, count }) => ({ feature, operation, result, count }))
      .sort((left, right) =>
        left.feature.localeCompare(right.feature)
        || left.operation.localeCompare(right.operation)
        || left.result.localeCompare(right.result)),
  };
}

export function clearOperationalMetricsForTests(): void {
  buckets.fill(null);
}