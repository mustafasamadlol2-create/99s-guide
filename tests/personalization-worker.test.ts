import assert from "node:assert/strict";
import test from "node:test";
import worker from "../cloudflare-personalization-api/src/index.js";

const secret = "test-personalization-secret";
const userId = "usr_worker-test";
const config = {
  version: 2 as const,
  themeId: "ocean" as const,
  heroStyle: "aurora" as const,
  glassStyle: "frosted" as const,
  motionStyle: "subtle" as const,
  readingSize: "large" as const,
  home: {
    subjectOrder: ["SSC", "ImD", "PHC", "CA", "RM", "NT", "ID"],
    hiddenSubjectIds: ["NT"],
    semesterVisibility: { semester1: true, semester2: false },
  },
};

class MemoryKv {
  readonly values = new Map<string, string>();
  writes = 0;
  failWrites = false;
  cacheTtls: number[] = [];

  async get(key: string, options?: { type: "json"; cacheTtl?: number }) {
    if (options?.cacheTtl !== undefined) this.cacheTtls.push(options.cacheTtl);
    const raw = this.values.get(key);
    return raw ? JSON.parse(raw) : null;
  }

  async put(key: string, value: string) {
    this.writes += 1;
    if (this.failWrites) throw new Error("429 throttled");
    this.values.set(key, value);
  }
}

function env(kv: MemoryKv) {
  return { PERSONALIZATION_KV: kv, PERSONALIZATION_SYNC_SECRET: secret };
}

async function call(
  kv: MemoryKv,
  method: "GET" | "PUT",
  path = `/personalization/${encodeURIComponent(userId)}`,
  body?: unknown,
  suppliedSecret = secret,
) {
  return worker.fetch(
    new Request(`https://worker.invalid${path}`, {
      method,
      headers: {
        "X-Personalization-Sync-Secret": suppliedSecret,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env(kv),
  );
}

test("Worker requires its private secret and validates canonical IDs", async () => {
  const kv = new MemoryKv();
  assert.equal((await call(kv, "GET", `/personalization/${userId}`, undefined, "wrong")).status, 401);
  assert.equal((await call(kv, "GET", "/personalization/person%40example.com")).status, 400);
  assert.equal((await call(kv, "GET")).status, 200);
  assert.deepEqual(await (await call(kv, "GET")).json(), { status: "empty", record: null });
  assert.equal(kv.cacheTtls.every((value) => value === 30), true);
});

test("Worker uses the exact KV key, record shape, subject permutations, and idempotency", async () => {
  const kv = new MemoryKv();
  const payload = { config, intentId: "pi_worker-intent", knownRevision: null };
  const first = await call(kv, "PUT", undefined, payload);
  assert.equal(first.status, 200);
  const firstBody = await first.json() as { record: Record<string, unknown> };
  assert.equal(firstBody.record.recordVersion, 2);
  assert.equal(firstBody.record.lastIntentId, payload.intentId);
  assert.equal(kv.writes, 1);
  assert.equal(kv.values.has("personalization:v2:" + encodeURIComponent(userId)), true);

  const duplicate = await call(kv, "PUT", undefined, payload);
  assert.equal(duplicate.status, 200);
  assert.equal(kv.writes, 1);

  const reordered = {
    ...payload,
    intentId: "pi_worker-intent-2",
    config: {
      ...config,
      home: {
        ...config.home,
        subjectOrder: [...config.home.subjectOrder].reverse(),
      },
    },
  };
  assert.equal((await call(kv, "PUT", undefined, reordered)).status, 200);
  assert.equal(kv.writes, 2);
});

test("Worker maps KV throttling to 429 with Retry-After", async () => {
  const kv = new MemoryKv();
  kv.failWrites = true;
  const response = await call(kv, "PUT", undefined, {
    config,
    intentId: "pi_worker-throttle",
    knownRevision: null,
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "5");
});