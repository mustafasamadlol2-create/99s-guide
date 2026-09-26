import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { getChallengeMetricValueForWindow } from "../server/features/gamification/challengeMetrics.js";

const start = new Date("2026-09-25T00:00:00.000Z");
const end = new Date("2026-09-26T00:00:00.000Z");
const asOf = new Date("2026-09-25T12:00:00.000Z");

function fakeTx(overrides: Record<string, unknown> = {}) {
  const calls: Record<string, unknown> = {};
  const tx = {
    focusSession: {
      count: async ({ where }: { where: unknown }) => {
        calls.focus = where;
        return 2;
      },
      aggregate: async ({ where }: { where: unknown }) => {
        calls.focus = where;
        return { _sum: { activeSeconds: 1500 } };
      },
      findMany: async () => [],
    },
    groupFocusParticipantSummary: {
      count: async ({ where }: { where: unknown }) => {
        calls.group = where;
        return 1;
      },
      findMany: async () => [],
    },
    $queryRaw: async () => [{ start, end }],
    studyEvent: { findMany: async () => [] },
    integritySignal: { count: async () => 0, findMany: async () => [] },
    ...overrides,
  };
  return { tx: tx as unknown as Prisma.TransactionClient, calls };
}

test("focus metrics use canonical status, positive duration, and half-open window", async () => {
  const { tx, calls } = fakeTx();
  assert.equal(
    await getChallengeMetricValueForWindow({
      userId: "u1", metricId: "focus.completed_sessions", startsAt: start, endsAt: end, asOf, tx,
    }),
    2,
  );
  assert.deepEqual(calls.focus, {
    userId: "u1",
    status: "COMPLETED",
    activeSeconds: { gt: 0 },
    actualEndedAt: { gte: start, lt: asOf },
  });
  assert.equal(
    await getChallengeMetricValueForWindow({
      userId: "u1", metricId: "focus.verified_seconds", startsAt: start, endsAt: end, asOf, tx,
    }),
    1500,
  );
});

test("group runs require the member summary, positive seconds, and both runtime bounds", async () => {
  const { tx, calls } = fakeTx();
  await getChallengeMetricValueForWindow({
    userId: "u1", metricId: "group_focus.completed_runs", startsAt: start, endsAt: end, asOf, tx,
  });
  assert.deepEqual(calls.group, {
    userId: "u1",
    verifiedFocusSeconds: { gt: 0 },
    run: {
      runtimeStartedAt: { gte: start, lt: asOf },
      runtimeEndedAt: { gte: start, lt: asOf },
    },
  });
});

test("qualifying days use the canonical Baghdad-day authority and threshold", async () => {
  const days: string[] = [];
  const { tx } = fakeTx({
    focusSession: {
      findMany: async () => [{
        id: "s1", activeSeconds: 1500, actualEndedAt: new Date("2026-09-25T10:00:00Z"),
      }],
    },
    studyEvent: {
      findMany: async () => [{
        focusSessionId: "s1", source: "backend", evidenceClass: "SERVER_VALIDATED",
        occurredAt: new Date("2026-09-25T10:00:00Z"), payload: { activeSeconds: 1500 },
      }],
    },
    $queryRaw: async () => {
      days.push("queried");
      return [{
        start: new Date("2026-09-25T00:00:00Z"),
        end: new Date("2026-09-26T00:00:00Z"),
      }];
    },
  });
  assert.equal(await getChallengeMetricValueForWindow({
    userId: "u1", metricId: "consistency.qualifying_days", startsAt: start, endsAt: end, asOf, tx,
  }), 1);
  assert.equal(days.length, 1);
});

test("invalid windows and source failures propagate", async () => {
  const { tx } = fakeTx({
    focusSession: { count: async () => { throw new Error("source failed"); } },
  });
  await assert.rejects(
    getChallengeMetricValueForWindow({
      userId: "u1", metricId: "focus.completed_sessions", startsAt: end, endsAt: start, asOf, tx,
    }),
    /non-empty/,
  );
  await assert.rejects(
    getChallengeMetricValueForWindow({
      userId: "u1", metricId: "focus.completed_sessions", startsAt: start, endsAt: end, asOf, tx,
    }),
    /source failed/,
  );
});