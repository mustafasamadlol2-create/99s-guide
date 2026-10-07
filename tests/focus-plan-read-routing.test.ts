import assert from "node:assert/strict";
import test from "node:test";
import { createFocusService } from "../server/features/focus/service.js";

test("Focus plan reads fall back to PostgreSQL on empty D1 and skip D1 for canonical reads", async () => {
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
            return [plan];
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
  assert.equal(postgresQueries.length, 2);
});
