import assert from "node:assert/strict";
import test from "node:test";
import { createFocusService } from "../server/features/focus/service.js";
import type { FocusSessionProjection } from "../server/features/study-core/projection.js";

const userId = "focus-user";
const sessionId = "11111111-1111-4111-8111-111111111111";
const planId = "22222222-2222-4222-8222-222222222222";
const planItemId = "33333333-3333-4333-8333-333333333333";
const lectureId = "44444444-4444-4444-8444-444444444444";
const now = new Date("2026-10-09T09:20:00.000Z");
const updatedAt = new Date("2026-10-09T09:10:00.000Z");

function makeProjection(overrides: Partial<FocusSessionProjection> = {}): FocusSessionProjection {
  return {
    id: sessionId,
    canonicalId: sessionId,
    revision: "17",
    projectionVersion: 1,
    updatedAt: updatedAt.toISOString(),
    deletedAt: null,
    userId,
    userScope: userId,
    planId,
    planItemId,
    lectureId,
    status: "ACTIVE",
    startedAt: "2026-10-09T09:00:00.000Z",
    plannedEndAt: "2026-10-09T09:25:00.000Z",
    actualEndedAt: null,
    lastCheckpointAt: "2026-10-09T09:19:00.000Z",
    activeSeconds: 1_140,
    pauseSeconds: 0,
    completionReason: null,
    ...overrides,
  };
}

const canonicalState = {
  id: sessionId,
  planId,
  planItemId,
  lectureId,
  status: "ACTIVE",
  projectionRevision: 17n,
  updatedAt,
  planItem: { sessionCount: 3 },
};

function makeCanonicalSession(overrides: Record<string, unknown> = {}) {
  return {
    id: sessionId,
    userId,
    planId,
    planItemId,
    lectureId,
    status: "ACTIVE",
    startedAt: new Date("2026-10-09T09:00:00.000Z"),
    plannedEndAt: new Date("2026-10-09T09:25:00.000Z"),
    actualEndedAt: null,
    lastCheckpointAt: new Date("2026-10-09T09:19:00.000Z"),
    activeSeconds: 1_140,
    pauseSeconds: 0,
    completionReason: null,
    createdAt: new Date("2026-10-09T09:00:00.000Z"),
    updatedAt,
    planItem: { sessionCount: 3 },
    ...overrides,
  };
}

function makeService(input: {
  projections: (userId: string, options?: { status?: string; limit?: number }) => Promise<FocusSessionProjection[]>;
  canonicalState?: unknown[];
  canonicalSession?: unknown;
  onFindMany?: (query: Record<string, unknown>) => void;
  count?: () => Promise<number>;
}) {
  const queries: Array<Record<string, unknown>> = [];
  let countCalls = 0;
  const service = createFocusService({
    repository: {
      database: {
        focusSession: {
          findMany: async (query: Record<string, unknown>) => {
            queries.push(query);
            input.onFindMany?.(query);
            return query.select
              ? input.canonicalState ?? [canonicalState]
              : input.canonicalSession === null
                ? []
                : [input.canonicalSession ?? makeCanonicalSession()];
          },
          count: async () => {
            countCalls += 1;
            return input.count ? input.count() : 0;
          },
        },
      },
    } as never,
    studyPointsAwarder: {} as never,
    isFocusEnabled: () => true,
    isStudyEventsEnabled: () => true,
    d1SessionReadsEnabled: () => true,
    fetchSessionsFromD1: input.projections,
    now: () => now,
  });
  return { service, queries, getCountCalls: () => countCalls };
}

test("current-session D1 hit uses the fresh projection and only a small canonical watermark read", async () => {
  const projectionRequests: Array<{ userId: string; options?: { status?: string; limit?: number } }> = [];
  const { service, queries, getCountCalls } = makeService({
    projections: async (requestedUserId, options) => {
      projectionRequests.push({ userId: requestedUserId, options });
      return [makeProjection()];
    },
  });

  const result = await service.currentSession(userId);

  assert.equal(result.session?.id, sessionId);
  assert.equal(result.session?.status, "ACTIVE");
  assert.equal(result.session?.plannedSessionCount, 3);
  assert.deepEqual(projectionRequests, [{ userId, options: { limit: 2 } }]);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0]?.where, { userId, status: { in: ["CREATED", "ACTIVE", "PAUSED", "RESOURCE_HANDOFF", "RECONCILIATION_REQUIRED"] } });
  assert.deepEqual(queries[0]?.select, {
    id: true,
    planId: true,
    planItemId: true,
    lectureId: true,
    status: true,
    projectionRevision: true,
    updatedAt: true,
    planItem: { select: { sessionCount: true } },
  });
  assert.equal(getCountCalls(), 1);
});

test("missing or unavailable D1 projections fall back to the canonical PostgreSQL session", async (t) => {
  await t.test("missing row", async () => {
    const { service, queries } = makeService({ projections: async () => [] });
    const result = await service.currentSession(userId);
    assert.equal(result.session?.id, sessionId);
    assert.equal(queries.length, 2);
    assert.ok(queries[0]?.select);
    assert.ok(queries[1]?.include);
  });

  await t.test("unavailable Worker", async () => {
    const { service, queries } = makeService({
      projections: async () => { throw new Error("Worker unavailable"); },
    });
    const result = await service.currentSession(userId);
    assert.equal(result.session?.id, sessionId);
    assert.equal(queries.length, 1);
    assert.ok(queries[0]?.include);
  });
});

test("a stale session revision cannot override the canonical state", async () => {
  const stale = makeProjection({ revision: "16" });
  const { service, queries } = makeService({ projections: async () => [stale] });

  const result = await service.currentSession(userId);

  assert.equal(result.session?.id, sessionId);
  assert.equal(result.session?.status, "ACTIVE");
  assert.equal(queries.length, 2);
  assert.ok(queries[1]?.include);
});

test("a projection from another user is rejected and never returned", async () => {
  const foreignProjection = makeProjection({ userId: "other-user", userScope: "other-user" });
  const receivedUserIds: string[] = [];
  const { service, queries } = makeService({
    projections: async (requestedUserId) => {
      receivedUserIds.push(requestedUserId);
      return [foreignProjection];
    },
  });

  const result = await service.currentSession(userId);

  assert.deepEqual(receivedUserIds, [userId]);
  assert.equal(result.session?.id, sessionId);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0]?.where, {
    userId,
    status: { in: ["CREATED", "ACTIVE", "PAUSED", "RESOURCE_HANDOFF", "RECONCILIATION_REQUIRED"] },
  });
});

test("an invalid D1 timer snapshot falls back to PostgreSQL and preserves reconciliation behavior", async () => {
  const invalidProjection = makeProjection({ startedAt: "not-a-timestamp" });
  const invalidCanonical = makeCanonicalSession({
    plannedEndAt: new Date("2026-10-09T08:59:00.000Z"),
  });
  const { service, queries } = makeService({
    projections: async () => [invalidProjection],
    canonicalSession: invalidCanonical,
  });

  const result = await service.currentSession(userId);

  assert.equal(result.session?.status, "RECONCILIATION_REQUIRED");
  assert.equal(result.session?.reconciliationRequired, true);
  assert.equal(result.session?.activeSeconds, null);
  assert.equal(queries.length, 1);
  assert.ok(queries[0]?.include);
});
