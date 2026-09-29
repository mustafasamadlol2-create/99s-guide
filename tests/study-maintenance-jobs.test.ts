import assert from "node:assert/strict";
import test from "node:test";
import { createChallengeAdapter } from "../server/study-maintenance/jobs/challenges.js";
import { createLevelAdapter } from "../server/study-maintenance/jobs/levels.js";
import { createPointsAdapter } from "../server/study-maintenance/jobs/points.js";

function fakeDatabase(ids = ["a", "b"]): any {
  return {
    user: {
      findUnique: async ({ where }: any) =>
        ids.includes(where.id) ? { id: where.id } : null,
      findMany: async ({ where, take }: any) => ids
        .filter((id) => !where?.id?.gt || id > where.id.gt)
        .slice(0, take)
        .map((id) => ({ id })),
    },
  };
}

test("points adapter audits without repairing and applies only projection repair", async () => {
  const calls: any[] = [];
  const adapter = createPointsAdapter({
    database: fakeDatabase(),
    reconcile: async (input) => {
      calls.push(input);
      return {
        status: input.repairProjection ? "IN_SYNC" : "PROJECTION_DRIFT",
        repaired: Boolean(input.repairProjection),
        anomalyCodes: ["PROJECTION_DRIFT"],
      } as any;
    },
  });
  assert.deepEqual(await adapter.inspect({ id: "a" }, { asOf: "2026-01-01T00:00:00Z" }), {
    status: "PROJECTION_DRIFT", wouldChange: true, changed: false, code: "PROJECTION_DRIFT",
  });
  assert.deepEqual(await adapter.apply({ id: "a" }, { asOf: "2026-01-01T00:00:00Z" }), {
    status: "IN_SYNC", wouldChange: false, changed: true, code: "PROJECTION_DRIFT",
  });
  assert.deepEqual(calls, [
    { userId: "a", repairProjection: false },
    { userId: "a", repairProjection: true },
  ]);
});

test("level adapter reads reconciliation and refreshes only on apply", async () => {
  const calls: string[] = [];
  const adapter = createLevelAdapter({
    database: fakeDatabase(),
    inspect: async (id) => {
      calls.push(`inspect:${id}`);
      return { status: "LEVEL_STATE_STALE" } as any;
    },
    refresh: async (id) => {
      calls.push(`refresh:${id}`);
      return { level: { level: 2 } } as any;
    },
  });
  assert.equal((await adapter.inspect({ id: "a" }, { asOf: "2026-01-01T00:00:00Z" })).wouldChange, true);
  assert.deepEqual(await adapter.apply({ id: "a" }, { asOf: "2026-01-01T00:00:00Z" }), {
    status: "REBUILT", changed: true,
  });
  assert.deepEqual(calls, ["inspect:a", "refresh:a"]);
});

test("challenge adapter passes fixed asOf and repair mode to canonical service", async () => {
  const calls: any[] = [];
  const adapter = createChallengeAdapter({
    database: fakeDatabase(),
    reconcile: async (input) => {
      calls.push(input);
      return {
        repaired: input.repair === true,
        checks: input.repair ? [] : [{ status: "STALE_PROGRESS" }],
      } as any;
    },
  });
  const asOf = "2026-02-03T12:00:00.000Z";
  assert.equal((await adapter.inspect({ id: "a" }, { asOf })).wouldChange, true);
  assert.equal((await adapter.apply({ id: "a" }, { asOf })).changed, true);
  assert.equal(calls[0].repair, false);
  assert.equal(calls[1].repair, true);
  assert.equal(calls[0].asOf.toISOString(), asOf);
  assert.equal(calls[1].asOf.toISOString(), asOf);
});

test("user discovery uses stable IDs and requires explicit all or userId scope", async () => {
  const adapter = createPointsAdapter({
    database: fakeDatabase(["a", "b", "c"]),
    reconcile: async () => ({ status: "IN_SYNC", anomalyCodes: [], repaired: false } as any),
  });
  assert.deepEqual(await adapter.discoverBatch({ cursor: null, limit: 2, scope: '{"all":true}' }), {
    items: [{ id: "a" }, { id: "b" }], nextCursor: "b",
  });
  await assert.rejects(
    adapter.discoverBatch({ cursor: null, limit: 2, scope: "{}" }),
    /userId or all/,
  );
});