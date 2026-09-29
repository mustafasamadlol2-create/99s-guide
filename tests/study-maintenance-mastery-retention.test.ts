import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalMaintenanceScope,
  createMasteryMaintenanceAdapter,
} from "../server/study-maintenance/jobs/mastery.js";
import { createRetentionMaintenanceAdapter } from "../server/study-maintenance/jobs/retention.js";

const asOf = new Date("2026-01-02T03:04:05.000Z");

function source() {
  const calls: Array<{ cursor: string | null; limit: number; scope: string }> = [];
  return {
    calls,
    listCandidates: async ({ cursor, limit, scope }: {
      cursor: string | null;
      limit: number;
      scope: { userId?: string; lectureId?: string; all?: boolean };
    }) => {
      calls.push({ cursor, limit, scope: canonicalMaintenanceScope(scope) });
      if (cursor) return { items: [], nextCursor: null };
      return {
        items: [{ id: "u\u0000l", userId: "u", lectureId: "l" }],
        nextCursor: null,
      };
    },
  };
}

test("Mastery adapter validates canonical scope and delegates a fixed asOf", async () => {
  const candidates = source();
  const calls: Array<{ repair: boolean; asOf: Date; database?: unknown }> = [];
  const adapter = createMasteryMaintenanceAdapter({
    candidateSource: candidates,
    database: {} as never,
    reconcile: async (input) => {
      calls.push(input);
      return {
        status: input.repair ? "IN_SYNC" : "STATE_MISMATCH",
        mismatches: input.repair ? [] : ["STATE_MISMATCH"],
        repaired: input.repair,
        stored: null,
        computed: {} as never,
      };
    },
  });

  const page = await adapter.discoverBatch({
    cursor: null,
    limit: 25,
    scope: '{"lectureId":"l","userId":"u"}',
  });
  assert.equal(page.items[0]?.id, "u\u0000l");
  assert.deepEqual(candidates.calls[0], {
    cursor: null,
    limit: 25,
    scope: '{"userId":"u","lectureId":"l"}',
  });
  const inspected = await adapter.inspect(page.items[0]!, { asOf: asOf.toISOString() });
  const applied = await adapter.apply(page.items[0]!, { asOf: asOf.toISOString() });
  assert.equal(inspected.wouldChange, true);
  assert.equal(applied.changed, true);
  assert.deepEqual(calls.map((call) => call.repair), [false, true]);
  assert.ok(calls.every((call) => call.asOf.getTime() === asOf.getTime()));
});

test("Retention adapter uses the same canonical candidate set and repair API", async () => {
  const candidates = source();
  const calls: boolean[] = [];
  const adapter = createRetentionMaintenanceAdapter({
    candidateSource: candidates,
    database: {} as never,
    reconcile: async (input) => {
      calls.push(input.repair);
      return {
        status: input.repair ? "IN_SYNC" : "RETENTION_MISSING",
        mismatches: input.repair ? [] : ["RETENTION_MISSING"],
        repaired: input.repair,
        stored: null,
        computed: {} as never,
      };
    },
  });
  const item = (await adapter.discoverBatch({
    cursor: null,
    limit: 1,
    scope: '{"all":true}',
  })).items[0]!;
  assert.equal((await adapter.inspect(item, { asOf: asOf.toISOString() })).wouldChange, true);
  assert.equal((await adapter.apply(item, { asOf: asOf.toISOString() })).changed, true);
  assert.deepEqual(calls, [false, true]);
});

test("scope rejects an unbounded empty object and conflicting all filter", () => {
  const adapter = createMasteryMaintenanceAdapter({
    candidateSource: source(),
    database: {} as never,
    reconcile: async () => {
      throw new Error("not called");
    },
  });
  assert.rejects(
    adapter.discoverBatch({ cursor: null, limit: 1, scope: "{}" }),
    /must include userId, lectureId, or all/u,
  );
  assert.rejects(
    adapter.discoverBatch({ cursor: null, limit: 1, scope: '{"all":true,"userId":"u"}' }),
    /cannot be combined/u,
  );
});