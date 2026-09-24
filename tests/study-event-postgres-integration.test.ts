import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import test, { after, before } from "node:test";

import { getPrompt8PostgresGateUrl } from "./helpers/prompt8PostgresGate.js";
import type { IngestStudyEventInput } from "../server/features/study-events/types.js";

const databaseUrl = getPrompt8PostgresGateUrl();
const skipped = databaseUrl ? false : "Set the explicit Prompt 8 disposable-schema test markers to run.";
const GATE_NOW = new Date("2026-09-24T12:00:00.000Z");

type Fixture = { userId: string; lectureId: string; mcqId: string };

let prisma: PrismaClient | undefined;
let ingest: (input: IngestStudyEventInput) => Promise<{
  status: string;
  idempotency: string | null;
  metricUpdated: boolean;
}>;

if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = databaseUrl;
  process.env.SUPABASE_DATABASE_URL = "";
  before(async () => {
    const { getPrisma } = await import("../server/services/prismaClient.js");
    const { createStudyEventIngestionService } = await import("../server/features/study-events/service.js");
    prisma = getPrisma() as PrismaClient;
    await prisma.$connect();
    const service = createStudyEventIngestionService({ now: () => GATE_NOW });
    ingest = service.ingestStudyEvent;
  });
  after(async () => {
    await prisma?.$disconnect();
  });
}

function client(): PrismaClient {
  assert.ok(prisma);
  return prisma;
}

async function createFixture(): Promise<Fixture> {
  const user = await client().user.create({
    data: { email: `prompt8-${randomUUID()}@example.test` },
  });
  const lecture = await client().lecture.create({
    data: {
      name: "Prompt 8 PostgreSQL fixture",
      mainSubject: "Verification",
      trackMode: "test",
    },
  });
  const mcq = await client().mcq.create({
    data: {
      question: "Prompt 8 isolated test question",
      optionA: "A",
      optionB: "B",
      optionC: "C",
      optionD: "D",
      correctAnswer: "A",
      lectureId: lecture.id,
    },
  });
  return { userId: user.id, lectureId: lecture.id, mcqId: mcq.id };
}

async function removeFixture(fixture: Fixture): Promise<void> {
  await client().$executeRaw`
    DELETE FROM "PrivateD1SyncOutbox"
    WHERE "data"->>'userId' = ${fixture.userId}
  `;
  await client().user.delete({ where: { id: fixture.userId } });
  await client().lecture.delete({ where: { id: fixture.lectureId } });
}

async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const fixture = await createFixture();
  try {
    await run(fixture);
  } finally {
    await removeFixture(fixture);
  }
}

function mcqEvent(
  fixture: Fixture,
  idempotencyKey = `prompt8-${randomUUID()}`,
  correct = true,
): IngestStudyEventInput {
  return {
    eventType: "mcq_attempted",
    userId: fixture.userId,
    occurredAt: GATE_NOW,
    source: "backend",
    idempotencyKey,
    mcqId: fixture.mcqId,
    evidenceClass: "SERVER_VALIDATED",
    payload: { correct },
  };
}

async function counts(userId: string): Promise<{
  events: number;
  metrics: number;
  outbox: number;
}> {
  const [events, metrics, outboxRows] = await Promise.all([
    client().studyEvent.count({ where: { userId } }),
    client().studyDailyMetric.count({ where: { userId } }),
    client().$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM "PrivateD1SyncOutbox"
      WHERE "data"->>'userId' = ${userId}
    `,
  ]);
  return { events, metrics, outbox: Number(outboxRows[0].count) };
}

test("real PostgreSQL commit persists event, metric and derived outbox projection", { skip: skipped }, async () => {
  await withFixture(async (fixture) => {
    const beforeCounts = await counts(fixture.userId);
    const result = await ingest(mcqEvent(fixture, "prompt8-commit-0001", true));
    const afterCounts = await counts(fixture.userId);
    const metric = await client().studyDailyMetric.findUnique({
      where: {
        userId_metricDate: {
          userId: fixture.userId,
          metricDate: new Date("2026-09-24T00:00:00.000Z"),
        },
      },
    });
    const rows = await client().$queryRaw<Array<{
      id: string;
      revision: string;
      entity: string;
      operation: string;
      key: Record<string, unknown>;
      data: Record<string, unknown>;
    }>>`
      SELECT "id"::text AS id, "revision"::text AS revision,
             "entity", "operation", "key", "data"
      FROM "PrivateD1SyncOutbox"
      WHERE "data"->>'userId' = ${fixture.userId}
    `;
    assert.equal(result.idempotency, "FIRST_SEEN");
    assert.deepEqual(beforeCounts, { events: 0, metrics: 0, outbox: 0 });
    assert.deepEqual(afterCounts, { events: 1, metrics: 1, outbox: 1 });
    assert.equal(metric?.mcqAttempts, 1);
    assert.equal(metric?.mcqCorrect, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].entity, "StudyDailyMetric");
    assert.equal(rows[0].operation, "upsert");
    assert.equal(rows[0].revision, rows[0].id);
    assert.equal(rows[0].data.revision, rows[0].revision);
    assert.equal(rows[0].data.eventType, undefined);
    assert.deepEqual(rows[0].key, { id: metric?.id });
    console.log("PROMPT8_PG_COMMIT", JSON.stringify({
      before: beforeCounts,
      after: afterCounts,
      metric: { mcqAttempts: metric?.mcqAttempts, mcqCorrect: metric?.mcqCorrect },
      projectionRevision: rows[0].revision,
      rawStudyEventIncluded: false,
    }));
  });
});

test("real outbox insert failure rolls back StudyEvent and DailyMetric", { skip: skipped }, async () => {
  await withFixture(async (fixture) => {
    await client().$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "prompt8_fail_outbox_insert"()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'prompt8 isolated outbox failure';
      END;
      $$
    `);
    await client().$executeRawUnsafe(`
      CREATE TRIGGER "prompt8_fail_outbox_insert"
      BEFORE INSERT ON "PrivateD1SyncOutbox"
      FOR EACH ROW EXECUTE FUNCTION "prompt8_fail_outbox_insert"()
    `);
    try {
      await assert.rejects(
        ingest(mcqEvent(fixture, "prompt8-rollback-0001", true)),
        { code: "OUTBOX_FAILURE" },
      );
    } finally {
      await client().$executeRawUnsafe(
        'DROP TRIGGER "prompt8_fail_outbox_insert" ON "PrivateD1SyncOutbox"',
      );
      await client().$executeRawUnsafe('DROP FUNCTION "prompt8_fail_outbox_insert"()');
    }
    const afterCounts = await counts(fixture.userId);
    assert.deepEqual(afterCounts, { events: 0, metrics: 0, outbox: 0 });
    console.log("PROMPT8_PG_ROLLBACK", JSON.stringify(afterCounts));
  });
});

test("real same-payload replay and conflicting replay preserve counts", { skip: skipped }, async () => {
  await withFixture(async (fixture) => {
    const event = mcqEvent(fixture, "prompt8-idempotency-0001", true);
    const first = await ingest(event);
    const replay = await ingest(event);
    await assert.rejects(
      ingest(mcqEvent(fixture, "prompt8-idempotency-0001", false)),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    const stored = await counts(fixture.userId);
    const metric = await client().studyDailyMetric.findFirst({ where: { userId: fixture.userId } });
    assert.equal(first.idempotency, "FIRST_SEEN");
    assert.equal(replay.idempotency, "REPLAY_SAME_PAYLOAD");
    assert.deepEqual(stored, { events: 1, metrics: 1, outbox: 1 });
    assert.equal(metric?.mcqAttempts, 1);
    assert.equal(metric?.mcqCorrect, 1);
    console.log("PROMPT8_PG_IDEMPOTENCY", JSON.stringify({
      first: first.idempotency,
      replay: replay.idempotency,
      conflictingReplay: "IDEMPOTENCY_CONFLICT",
      counts: stored,
      metric: { mcqAttempts: metric?.mcqAttempts, mcqCorrect: metric?.mcqCorrect },
    }));
  });
});

test("10 concurrent identical events persist one event, metric increment and outbox row", { skip: skipped }, async () => {
  await withFixture(async (fixture) => {
    const event = mcqEvent(fixture, "prompt8-concurrent-same-0001", true);
    const results = await Promise.all(Array.from({ length: 10 }, () => ingest(event)));
    const stored = await counts(fixture.userId);
    const metric = await client().studyDailyMetric.findFirst({ where: { userId: fixture.userId } });
    assert.equal(results.filter((result) => result.idempotency === "FIRST_SEEN").length, 1);
    assert.equal(results.filter((result) => result.idempotency === "REPLAY_SAME_PAYLOAD").length, 9);
    assert.deepEqual(stored, { events: 1, metrics: 1, outbox: 1 });
    assert.equal(metric?.mcqAttempts, 1);
    assert.equal(metric?.mcqCorrect, 1);
    console.log("PROMPT8_PG_CONCURRENT_DUPLICATES", JSON.stringify({
      calls: results.length,
      firstSeen: 1,
      replayed: 9,
      counts: stored,
    }));
  });
});

test("concurrent conflicting events produce one winner and one conflict", { skip: skipped }, async () => {
  await withFixture(async (fixture) => {
    const key = "prompt8-concurrent-conflict-0001";
    const outcomes = await Promise.allSettled([
      ingest(mcqEvent(fixture, key, true)),
      ingest(mcqEvent(fixture, key, false)),
    ]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    const stored = await counts(fixture.userId);
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal((fulfilled[0] as PromiseFulfilledResult<{ idempotency: string | null }>).value.idempotency, "FIRST_SEEN");
    assert.equal(
      (rejected[0] as PromiseRejectedResult).reason?.code,
      "IDEMPOTENCY_CONFLICT",
    );
    assert.deepEqual(stored, { events: 1, metrics: 1, outbox: 1 });
    console.log("PROMPT8_PG_CONCURRENT_CONFLICT", JSON.stringify({
      fulfilled: fulfilled.length,
      conflicts: rejected.length,
      counts: stored,
    }));
  });
});

test("100 concurrent MCQ increments persist exactly 100 attempts and 73 correct", { skip: skipped }, async () => {
  await withFixture(async (fixture) => {
    const keys = Array.from({ length: 100 }, (_, index) => `prompt8-mcq-${String(index).padStart(3, "0")}`);
    await Promise.all(keys.map((key, index) =>
      ingest(mcqEvent(fixture, key, index < 73)),
    ));
    const stored = await counts(fixture.userId);
    const metric = await client().studyDailyMetric.findFirst({ where: { userId: fixture.userId } });
    assert.deepEqual(stored, { events: 100, metrics: 1, outbox: 100 });
    assert.equal(metric?.mcqAttempts, 100);
    assert.equal(metric?.mcqCorrect, 73);
    console.log("PROMPT8_PG_METRIC_CONCURRENCY", JSON.stringify({
      attemptsSent: 100,
      correctSent: 73,
      mcqAttemptsStored: metric?.mcqAttempts,
      mcqCorrectStored: metric?.mcqCorrect,
      outboxRows: stored.outbox,
    }));
  });
});