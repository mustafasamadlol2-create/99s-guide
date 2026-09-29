import assert from "node:assert/strict";
import { createServer } from "node:http";
import { PrismaClient } from "@prisma/client";
import test, { after, before } from "node:test";
import { OutboxDeliveryError } from "../server/services/outboxDeliveryPolicy.js";

import { getPrompt8PostgresGateUrl } from "./helpers/prompt8PostgresGate.js";

const databaseUrl = getPrompt8PostgresGateUrl();
const skipped = databaseUrl ? false : "Set the explicit Prompt 8 disposable-schema test markers to run.";

let prisma: PrismaClient | undefined;
let outbox: typeof import("../server/services/privateD1Sync.js");

if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = databaseUrl;
  process.env.SUPABASE_DATABASE_URL = "";
  before(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    outbox = await import("../server/services/privateD1Sync.js");
  });
  after(async () => {
    await prisma?.$executeRawUnsafe('DELETE FROM "PrivateD1SyncOutbox"');
    await prisma?.$disconnect();
  });
}

function client(): PrismaClient {
  assert.ok(prisma);
  return prisma;
}

async function clearRows(): Promise<void> {
  await client().$executeRawUnsafe('DELETE FROM "PrivateD1SyncOutbox"');
}

async function enqueueRows(count: number, prefix: string): Promise<string[]> {
  return Promise.all(Array.from({ length: count }, async (_, index) =>
    outbox.enqueuePrivateD1Projection(client(), {
      entity: "StudyDailyMetric",
      key: { id: `${prefix}-${index}` },
      data: {
        id: `${prefix}-${index}`,
        userId: prefix,
        metricDate: "2026-09-24",
        revision: "0",
      },
    }),
  ));
}

test("real PostgreSQL revisions are the single generated identity value", { skip: skipped }, async () => {
  await clearRows();
  const revisions = await enqueueRows(100, "prompt8-revision-test");
  const rows = await client().$queryRaw<Array<{ id: string; revision: string }>>`
    SELECT "id"::text AS id, "revision"::text AS revision
    FROM "PrivateD1SyncOutbox"
    WHERE "data"->>'userId' = ${"prompt8-revision-test"}
    ORDER BY "PrivateD1SyncOutbox"."id" ASC
  `;
  assert.equal(rows.length, 100);
  assert.deepEqual(rows.map((row) => row.revision), revisions.sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0,
  ));
  for (const row of rows) assert.equal(row.id, row.revision);
  for (let index = 1; index < rows.length; index += 1) {
    assert.ok(BigInt(rows[index].revision) > BigInt(rows[index - 1].revision));
  }
  console.log("PROMPT8_PG_REVISIONS", JSON.stringify({
    count: rows.length,
    first: rows[0].revision,
    last: rows.at(-1)?.revision,
    strictlyIncreasing: true,
    idEqualsRevision: true,
  }));
});

test("two real PostgreSQL lease calls claim disjoint batches", { skip: skipped }, async () => {
  await clearRows();
  await enqueueRows(60, "prompt8-lease-disjoint");
  const independentWorkerA = new PrismaClient({
    datasources: { db: { url: databaseUrl as string } },
  });
  const independentWorkerB = new PrismaClient({
    datasources: { db: { url: databaseUrl as string } },
  });
  try {
    await Promise.all([independentWorkerA.$connect(), independentWorkerB.$connect()]);
    const [workerA, workerB] = await Promise.all([
      outbox.leasePrivateD1SyncOutboxBatch(independentWorkerA),
      outbox.leasePrivateD1SyncOutboxBatch(independentWorkerB),
    ]);
    const workerC = await outbox.leasePrivateD1SyncOutboxBatch(client());
    const workerD = await outbox.leasePrivateD1SyncOutboxBatch(client());
    const idsA = new Set(workerA.map((row) => row.id));
    const idsB = new Set(workerB.map((row) => row.id));
    const overlapAB = workerB.filter((row) => idsA.has(row.id)).length;
    const overlapC = workerC.filter((row) => idsA.has(row.id) || idsB.has(row.id)).length;
    assert.equal(workerA.length, 25);
    assert.equal(workerB.length, 25);
    assert.equal(workerC.length, 10);
    assert.equal(workerD.length, 0);
    assert.equal(overlapAB, 0);
    assert.equal(overlapC, 0);
    console.log("PROMPT8_PG_LEASE", JSON.stringify({
      workerA: workerA.map((row) => row.id),
      workerB: workerB.map((row) => row.id),
      workerC: workerC.map((row) => row.id),
      immediateReleases: workerD.length,
      overlap: overlapAB + overlapC,
    }));
  } finally {
    await Promise.all([
      independentWorkerA.$disconnect(),
      independentWorkerB.$disconnect(),
    ]);
  }
});

test("expired lease fencing prevents stale acknowledgement and failure updates", { skip: skipped }, async () => {
  await clearRows();
  const [revision] = await enqueueRows(1, "prompt8-lease-fence");
  const original = await outbox.leasePrivateD1SyncOutboxBatch(client());
  assert.equal(original.length, 1);
  assert.equal(original[0].revision, revision);
  assert.equal(original[0].attempts, 1);

  await client().$executeRaw`
    UPDATE "PrivateD1SyncOutbox"
    SET "nextAttemptAt" = NOW() - INTERVAL '1 second',
        "leaseUntil" = NOW() - INTERVAL '1 second'
    WHERE "id" = ${original[0].id}::bigint
      AND "revision" = ${original[0].revision}::bigint
      AND "attempts" = ${original[0].attempts}
  `;
  const reclaimed = await outbox.leasePrivateD1SyncOutboxBatch(client());
  assert.equal(reclaimed.length, 1);
  assert.equal(reclaimed[0].id, original[0].id);
  assert.equal(reclaimed[0].attempts, 2);

  assert.equal(
    await outbox.acknowledgePrivateD1SyncOutboxRow(original[0], client()),
    0,
  );
  assert.equal(
    await outbox.markPrivateD1SyncOutboxRowFailure(
      original[0],
      new Error("late worker failure"),
      client(),
    ),
    0,
  );
  assert.equal(
    await client().$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM "PrivateD1SyncOutbox"
      WHERE "id" = ${revision}::bigint
    `.then((rows) => Number(rows[0].count)),
    1,
  );
  assert.equal(
    await outbox.acknowledgePrivateD1SyncOutboxRow(reclaimed[0], client()),
    1,
  );
  const [acknowledged] = await client().$queryRaw<Array<{ state: string; terminalAt: Date | null }>>`
    SELECT "state", "terminalAt"
    FROM "PrivateD1SyncOutbox"
    WHERE "id" = ${revision}::bigint
  `;
  assert.equal(acknowledged.state, "SUCCEEDED");
  assert.ok(acknowledged.terminalAt);
  console.log("PROMPT8_PG_STALE_ACK", JSON.stringify({
    firstAttempt: original[0].attempts,
    reclaimedAttempt: reclaimed[0].attempts,
    staleAckAffected: 0,
    staleFailureAffected: 0,
    currentAckAffected: 1,
  }));
});

test("real retry state is bounded, redacted, and follows the capped backoff", { skip: skipped }, async () => {
  await clearRows();
  await enqueueRows(1, "prompt8-retry-test");
  const [leased] = await outbox.leasePrivateD1SyncOutboxBatch(client());
  const previousUpdatedAt = await client().$queryRaw<Array<{ updatedAt: Date }>>`
    SELECT "updatedAt" FROM "PrivateD1SyncOutbox"
    WHERE "id" = ${leased.id}::bigint
  `.then((rows) => rows[0].updatedAt);

  const error = new OutboxDeliveryError(
    `Bearer abc.def.ghi {"token":"topsecret"} x-private-data-sync-secret: hidden ${"x".repeat(700)}`,
    { failureClass: "TRANSIENT", failureCode: "NETWORK_OR_TIMEOUT" },
  );
  assert.equal(
    await outbox.markPrivateD1SyncOutboxRowFailure(leased, error, client()),
    1,
  );
  const [stored] = await client().$queryRaw<Array<{
    attempts: number;
    lastError: string;
    nextAttemptAt: Date;
    updatedAt: Date;
  }>>`
    SELECT "attempts", "lastError", "nextAttemptAt", "updatedAt"
    FROM "PrivateD1SyncOutbox"
    WHERE "id" = ${leased.id}::bigint
  `;
  assert.equal(stored.attempts, 1);
  assert.ok(stored.lastError.length <= 500);
  assert.doesNotMatch(stored.lastError, /abc\.def\.ghi|topsecret|hidden/u);
  assert.match(stored.lastError, /\[REDACTED\]/u);
  assert.ok(stored.nextAttemptAt.getTime() - Date.now() >= 7_000);
  assert.ok(stored.nextAttemptAt.getTime() - Date.now() <= 16_000);
  assert.ok(stored.updatedAt.getTime() >= previousUpdatedAt.getTime());
  await client().$executeRaw`
    UPDATE "PrivateD1SyncOutbox"
    SET "nextAttemptAt" = NOW() - INTERVAL '1 second'
    WHERE "id" = ${leased.id}::bigint
  `;
  const [retried] = await outbox.leasePrivateD1SyncOutboxBatch(client());
  assert.equal(retried.attempts, 2);
  const retryDelaysSeconds = [Math.round((stored.nextAttemptAt.getTime() - Date.now()) / 1000)];
  let currentLease = retried;
  const retryBoundsSeconds: Array<[number, number]> = [
    [15, 30],
    [30, 60],
    [60, 120],
    [120, 240],
    [150, 300],
    [150, 300],
  ];
  for (const [minimum, maximum] of retryBoundsSeconds) {
    assert.equal(
      await outbox.markPrivateD1SyncOutboxRowFailure(
        currentLease,
        new OutboxDeliveryError("retry schedule verification", {
          failureClass: "TRANSIENT",
          failureCode: "NETWORK_OR_TIMEOUT",
        }),
        client(),
      ),
      1,
    );
    const [retryState] = await client().$queryRaw<Array<{
      nextAttemptAt: Date;
    }>>`
      SELECT "nextAttemptAt"
      FROM "PrivateD1SyncOutbox"
      WHERE "id" = ${currentLease.id}::bigint
    `;
    const actualDelay = Math.round(
      (retryState.nextAttemptAt.getTime() - Date.now()) / 1000,
    );
    assert.ok(actualDelay >= minimum - 1);
    assert.ok(actualDelay <= maximum + 1);
    retryDelaysSeconds.push(actualDelay);
    await client().$executeRaw`
      UPDATE "PrivateD1SyncOutbox"
      SET "nextAttemptAt" = NOW() - INTERVAL '1 second'
      WHERE "id" = ${currentLease.id}::bigint
        AND "attempts" = ${currentLease.attempts}
    `;
    const [nextLease] = await outbox.leasePrivateD1SyncOutboxBatch(client());
    assert.equal(nextLease.attempts, currentLease.attempts + 1);
    currentLease = nextLease;
  }
  assert.equal(
    currentLease.attempts,
    8,
  );
  assert.equal(
    await outbox.markPrivateD1SyncOutboxRowFailure(
      currentLease,
      new OutboxDeliveryError("retry limit reached", {
        failureClass: "TRANSIENT",
        failureCode: "NETWORK_OR_TIMEOUT",
      }),
      client(),
    ),
    1,
  );
  const [exhausted] = await client().$queryRaw<Array<{
    state: string;
    failureCode: string | null;
    terminalAt: Date | null;
  }>>`
    SELECT "state", "failureCode", "terminalAt"
    FROM "PrivateD1SyncOutbox"
    WHERE "id" = ${currentLease.id}::bigint
  `;
  assert.equal(exhausted.state, "POISON");
  assert.equal(exhausted.failureCode, "MAX_ATTEMPTS");
  assert.ok(exhausted.terminalAt);
  console.log("PROMPT8_PG_RETRY", JSON.stringify({
    attemptsAfterFirstLease: stored.attempts,
    retryDelaysSeconds,
    errorLength: stored.lastError.length,
    redacted: true,
    attemptsAfterRetryLease: retried.attempts,
    exhaustedAttempt: currentLease.attempts,
    terminalState: exhausted.state,
  }));
});

test("real acknowledgement requires both the current revision and lease attempt", { skip: skipped }, async () => {
  await clearRows();
  await enqueueRows(2, "prompt8-ack-test");
  const leasedRows = await outbox.leasePrivateD1SyncOutboxBatch(client());
  assert.equal(leasedRows.length, 2);
  const [leased, unrelated] = leasedRows;
  const staleRevision = { ...leased, revision: String(BigInt(leased.revision) + 1n) };
  assert.equal(
    await outbox.acknowledgePrivateD1SyncOutboxRow(staleRevision, client()),
    0,
  );
  assert.equal(
    await outbox.acknowledgePrivateD1SyncOutboxRow({ ...leased, attempts: 0 }, client()),
    0,
  );
  assert.equal(
    await outbox.acknowledgePrivateD1SyncOutboxRow(leased, client()),
    1,
  );
  const remaining = await client().$queryRaw<Array<{ id: string; state: string }>>`
    SELECT "id"::text AS id, "state"
    FROM "PrivateD1SyncOutbox"
    WHERE "id" IN (${leased.id}::bigint, ${unrelated.id}::bigint)
    ORDER BY "id" ASC
  `;
  assert.deepEqual(remaining.map((row) => row.id), [leased.id, unrelated.id]);
  assert.deepEqual(remaining.map((row) => row.state), ["SUCCEEDED", "PENDING"]);
  assert.equal(
    await outbox.acknowledgePrivateD1SyncOutboxRow(unrelated, client()),
    1,
  );
});

test("local delivery serializes revision as decimal text without contacting Cloudflare", { skip: skipped }, async () => {
  await clearRows();
  await enqueueRows(1, "prompt8-local-delivery");
  const [leasedRow] = await outbox.leasePrivateD1SyncOutboxBatch(client());
  const originalBase = process.env.PRIVATE_DATA_WORKER_BASE_URL;
  const originalSecret = process.env.PRIVATE_DATA_SYNC_SECRET;
  let received: { headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> } | null = null;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received = {
        headers: request.headers,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
      };
      response.writeHead(204);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    process.env.PRIVATE_DATA_WORKER_BASE_URL = `http://127.0.0.1:${address.port}`;
    process.env.PRIVATE_DATA_SYNC_SECRET = "prompt8-local-test-only";
    await outbox.postPrivateD1SyncMutation(leasedRow);
    assert.ok(received);
    const body = received.body;
    assert.deepEqual(Object.keys(body).sort(), [
      "data",
      "entity",
      "key",
      "occurredAt",
      "operation",
      "projectionVersion",
      "revision",
      "userScope",
      "version",
    ]);
    assert.equal(body.version, 1);
    assert.equal(body.entity, "StudyDailyMetric");
    assert.equal(body.operation, "upsert");
    assert.deepEqual(body.key, { id: "prompt8-local-delivery-0" });
    assert.equal(body.revision, leasedRow.revision);
    assert.equal(typeof body.revision, "string");
    assert.equal(body.projectionVersion, 1);
    assert.equal(body.userScope, "prompt8-local-delivery");
    assert.ok(!Number.isNaN(Date.parse(String(body.occurredAt))));
    assert.deepEqual(
      Object.keys(body.data as Record<string, unknown>).sort(),
      ["id", "metricDate", "revision", "userId"],
    );
    assert.equal((body.data as Record<string, unknown>).eventType, undefined);
    assert.equal(received.headers["x-private-data-sync-secret"], "prompt8-local-test-only");
    received = null;
    await outbox.postPrivateD1SyncMutation({
      ...leasedRow,
      id: "9007199254740992",
      revision: "9007199254740992",
      key: { id: "metric-precision" },
      data: {
        ...leasedRow.data,
        id: "metric-precision",
        revision: "9007199254740992",
      },
    });
    assert.ok(received);
    assert.equal(received.body.revision, "9007199254740992");
    assert.equal(typeof received.body.revision, "string");
    console.log("PROMPT8_LOCAL_DELIVERY", JSON.stringify({
      realRevision: leasedRow.revision,
      precisionBoundaryRevision: received.body.revision,
      envelopeFields: Object.keys(body).sort(),
      dataFields: Object.keys(body.data as Record<string, unknown>).sort(),
      rawStudyEventIncluded: false,
      target: "127.0.0.1",
    }));
  } finally {
    if (originalBase === undefined) delete process.env.PRIVATE_DATA_WORKER_BASE_URL;
    else process.env.PRIVATE_DATA_WORKER_BASE_URL = originalBase;
    if (originalSecret === undefined) delete process.env.PRIVATE_DATA_SYNC_SECRET;
    else process.env.PRIVATE_DATA_SYNC_SECRET = originalSecret;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
});