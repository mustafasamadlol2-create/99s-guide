import assert from "node:assert/strict";
import test from "node:test";
import { createFocusService } from "../server/features/focus/service.js";
import type { StudyDailyMetricProjection } from "../server/features/study-core/projection.js";

const USER_ID = "focus-metrics-user";
const METRIC_DATE = "2026-09-26";
const METRIC_NOW = new Date("2026-09-25T22:00:00.000Z");

function projection(input: {
  revision: string;
  focusSeconds: number;
  updatedAt?: string;
}): StudyDailyMetricProjection {
  const id = "11111111-1111-4111-8111-111111111111";
  return {
    id,
    canonicalId: id,
    revision: input.revision,
    projectionVersion: 1,
    updatedAt: input.updatedAt ?? "2026-09-26T10:00:00.000Z",
    deletedAt: null,
    userScope: USER_ID,
    userId: USER_ID,
    metricDate: METRIC_DATE,
    focusSeconds: input.focusSeconds,
    sessionsCompleted: 1,
    mcqAttempts: 0,
    mcqCorrect: 0,
    flashcardReviews: 0,
    recallAttempts: 0,
    recallCorrect: 0,
    lectureCompletions: 0,
    interruptionCount: 0,
  };
}

function metricRow(input: {
  projectionRevision: bigint;
  focusSeconds: number;
  updatedAt?: Date;
}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    metricDate: new Date(`${METRIC_DATE}T00:00:00.000Z`),
    projectionRevision: input.projectionRevision,
    updatedAt: input.updatedAt ?? new Date("2026-09-26T10:00:00.000Z"),
    focusSeconds: input.focusSeconds,
    sessionsCompleted: 1,
    interruptionCount: 0,
  };
}

function createService(input: {
  canonical: ReturnType<typeof metricRow>;
  d1: () => Promise<StudyDailyMetricProjection[]>;
  calls?: string[];
}) {
  const calls = input.calls ?? [];
  const service = createFocusService({
    repository: {
      database: {
        studyDailyMetric: {
          findMany: async (query: Record<string, unknown>) => {
            const select = query.select as Record<string, unknown> | undefined;
            if (select && "projectionRevision" in select) {
              calls.push("watermark");
              return [{
                id: input.canonical.id,
                metricDate: input.canonical.metricDate,
                projectionRevision: input.canonical.projectionRevision,
                updatedAt: input.canonical.updatedAt,
              }];
            }
            calls.push("postgres");
            return [input.canonical];
          },
        },
      },
    } as never,
    studyPointsAwarder: {} as never,
    isFocusEnabled: () => true,
    d1MetricReadsEnabled: () => true,
    fetchMetricsFromD1: input.d1,
    now: () => METRIC_NOW,
  });
  return { service, calls };
}

test("a D1 metric matching the canonical revision remains the normal read path", async () => {
  const { service, calls } = createService({
    canonical: metricRow({ projectionRevision: 41n, focusSeconds: 900 }),
    d1: async () => [projection({ revision: "41", focusSeconds: 900 })],
  });

  const result = await service.getMetrics(USER_ID, "today");
  assert.equal(result.totals.focusSeconds, 900);
  assert.deepEqual(calls, ["watermark"]);
});

test("read-after-write falls back to PostgreSQL while the matching outbox revision is delayed", async () => {
  const { service, calls } = createService({
    canonical: metricRow({ projectionRevision: 42n, focusSeconds: 1_500 }),
    d1: async () => [projection({ revision: "41", focusSeconds: 900 })],
  });

  const result = await service.getMetrics(USER_ID, "today");
  assert.equal(result.totals.focusSeconds, 1_500);
  assert.deepEqual(calls, ["watermark", "postgres"]);
});

test("a concurrent canonical metric update during a D1 request wins over its delayed response", async () => {
  let canonical = metricRow({ projectionRevision: 51n, focusSeconds: 900 });
  let resolveD1!: (rows: StudyDailyMetricProjection[]) => void;
  const calls: string[] = [];
  const { service } = createService({
    get canonical() {
      return canonical;
    },
    d1: () => new Promise((resolve) => { resolveD1 = resolve; }),
    calls,
  });
  const response = service.getMetrics(USER_ID, "today");
  await new Promise<void>((resolve) => setImmediate(resolve));
  canonical = metricRow({ projectionRevision: 52n, focusSeconds: 1_800 });
  resolveD1([projection({ revision: "51", focusSeconds: 900 })]);

  const result = await response;
  assert.equal(result.totals.focusSeconds, 1_800);
  assert.deepEqual(calls, ["watermark", "postgres"]);
});

test("a missing D1 metric row is not accepted as a complete range", async () => {
  const { service, calls } = createService({
    canonical: metricRow({ projectionRevision: 63n, focusSeconds: 720 }),
    d1: async () => [],
  });

  const result = await service.getMetrics(USER_ID, "today");
  assert.equal(result.totals.focusSeconds, 720);
  assert.deepEqual(calls, ["watermark", "postgres"]);
});
