import assert from "node:assert/strict";
import test from "node:test";
import { createFocusService } from "../server/features/focus/service.js";

test("Focus plan reads fall back to PostgreSQL when D1 is empty and skip D1 for canonical reads", async () => {
  const userId = "focus-user";
  const postgresQueries: Array<Record<string, unknown>> = [];
  const d1Queries: Array<Record<string, unknown>> = [];
  const plan = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Canonical plan",
    status: "ACTIVE",
    timezone: "Asia/Baghdad",
    planVersion: 3,
    createdAt: new Date("2026-10-01T10:00:00.000Z"),
    updatedAt: new Date("2026-10-02T10:00:00.000Z"),
    archivedAt: null,
    items: [{
      id: "22222222-2222-4222-8222-222222222222",
      lectureId: "33333333-3333-4333-8333-333333333333",
      sequence: 1,
      sessionCount: 1,
      focusDurationSeconds: 1_500,
      breakDurationSeconds: 300,
      includeMcq: false,
      includeFlashcards: false,
      includeVideo: false,
    }],
  };
  const service = createFocusService({
    repository: {
      database: {
        focusPlan: {
          findMany: async (query: Record<string, unknown>) => {
            postgresQueries.push(query);
            return query.select ? [{ id: plan.id, planVersion: plan.planVersion }] : [plan];
          },
        },
      },
    } as never,
    studyPointsAwarder: {} as never,
    isFocusEnabled: () => true,
    d1PlanReadsEnabled: () => true,
    fetchPlansFromD1: async (_userId, options) => {
      d1Queries.push(options);
      return [];
    },
  });

  const fallbackPlans = await service.listPlans(userId, 1, { status: "ACTIVE" });
  assert.equal(fallbackPlans[0]?.title, "Canonical plan");
  assert.deepEqual(d1Queries, [{ limit: 1, status: "ACTIVE" }]);
  assert.deepEqual(postgresQueries[0], {
    where: { userId, status: "ACTIVE" },
    select: { id: true, planVersion: true },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 1,
  });
  assert.deepEqual(postgresQueries[1], {
    where: { userId, status: "ACTIVE" },
    include: { items: { orderBy: [{ sequence: "asc" }, { id: "asc" }] } },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 1,
  });

  const canonicalPlans = await service.listPlans(userId, 1, {
    status: "ACTIVE",
    canonical: true,
  });
  assert.equal(canonicalPlans[0]?.title, "Canonical plan");
  assert.equal(d1Queries.length, 1);
  assert.equal(postgresQueries.length, 3);
});

test("a delayed D1 plan projection cannot hide a canonical update or a newly created plan", async () => {
  const userId = "focus-user";
  const currentPlan = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Updated canonical plan",
    status: "ACTIVE",
    timezone: "Asia/Baghdad",
    planVersion: 4,
    createdAt: new Date("2026-10-01T10:00:00.000Z"),
    updatedAt: new Date("2026-10-03T10:00:00.000Z"),
    archivedAt: null,
    items: [],
  };
  const oldProjection = {
    ...currentPlan,
    title: "Old D1 plan",
    planVersion: 3,
    canonicalId: currentPlan.id,
    revision: "17",
    projectionVersion: 1,
    updatedAt: "2026-10-02T10:00:00.000Z",
    deletedAt: null,
    userId,
    userScope: userId,
    items: [],
  };
  const currentProjection = {
    ...oldProjection,
    id: "22222222-2222-4222-8222-222222222222",
    canonicalId: "22222222-2222-4222-8222-222222222222",
    title: "Stale D1 list",
    planVersion: 1,
  };
  const service = createFocusService({
    repository: {
      database: {
        focusPlan: {
          findMany: async (query: Record<string, unknown>) => query.select
            ? [{ id: currentPlan.id, planVersion: currentPlan.planVersion }]
            : [currentPlan],
        },
      },
    } as never,
    studyPointsAwarder: {} as never,
    isFocusEnabled: () => true,
    d1PlanReadsEnabled: () => true,
    fetchPlansFromD1: async () => [oldProjection] as never,
  });

  const afterUpdate = await service.listPlans(userId, 1, { status: "ACTIVE" });
  assert.equal(afterUpdate[0]?.title, "Updated canonical plan");
  assert.equal(afterUpdate[0]?.planVersion, 4);

  const createService = createFocusService({
    repository: {
      database: {
        focusPlan: {
          findMany: async (query: Record<string, unknown>) => query.select
            ? [{ id: currentProjection.id, planVersion: currentProjection.planVersion }]
            : [{
                ...currentPlan,
                id: currentProjection.id,
                title: "New canonical plan",
                planVersion: 1,
              }],
        },
      },
    } as never,
    studyPointsAwarder: {} as never,
    isFocusEnabled: () => true,
    d1PlanReadsEnabled: () => true,
    fetchPlansFromD1: async () => [] as never,
  });
  const afterCreate = await createService.listPlans(userId, 1, { status: "ACTIVE" });
  assert.equal(afterCreate[0]?.title, "New canonical plan");
});

test("a concurrent canonical plan update during the D1 request wins over the delayed response", async () => {
  const userId = "focus-user";
  let canonicalVersion = 3;
  let resolveD1!: (rows: never[]) => void;
  const staleProjection = {
    id: "11111111-1111-4111-8111-111111111111",
    canonicalId: "11111111-1111-4111-8111-111111111111",
    revision: "17",
    projectionVersion: 1,
    updatedAt: "2026-10-02T10:00:00.000Z",
    deletedAt: null,
    userId,
    userScope: userId,
    title: "Version 3",
    status: "ACTIVE",
    timezone: "Asia/Baghdad",
    planVersion: 3,
    createdAt: "2026-10-01T10:00:00.000Z",
    archivedAt: null,
    items: [],
  };
  const latestPlan = {
    ...staleProjection,
    title: "Version 4",
    planVersion: 4,
    createdAt: new Date("2026-10-01T10:00:00.000Z"),
    updatedAt: new Date("2026-10-03T10:00:00.000Z"),
    items: [],
  };
  const service = createFocusService({
    repository: {
      database: {
        focusPlan: {
          findMany: async (query: Record<string, unknown>) => query.select
            ? [{ id: latestPlan.id, planVersion: canonicalVersion }]
            : [latestPlan],
        },
      },
    } as never,
    studyPointsAwarder: {} as never,
    isFocusEnabled: () => true,
    d1PlanReadsEnabled: () => true,
    fetchPlansFromD1: async () => new Promise((resolve) => { resolveD1 = resolve; }),
  });
  const response = service.listPlans(userId, 1, { status: "ACTIVE" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  canonicalVersion = 4;
  resolveD1([staleProjection] as never);
  const plans = await response;
  assert.equal(plans[0]?.title, "Version 4");
  assert.equal(plans[0]?.planVersion, 4);
});
