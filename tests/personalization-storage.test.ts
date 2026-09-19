import test from "node:test";
import assert from "node:assert/strict";
import {
  PERSONALIZATION_SUBJECT_IDS,
  type PersonalizationConfigV1,
  createDefaultPersonalization,
} from "../shared/personalization.js";
import {
  PERSONALIZATION_CACHE_PREFIX,
  type PersonalizationKeyValueStorage,
  getPersonalizationCacheKey,
  readCachedPersonalization,
  removeCachedPersonalization,
  writeCachedPersonalization,
} from "../src/features/personalization/personalizationStorage.js";

class MemoryStorage implements PersonalizationKeyValueStorage {
  readonly values = new Map<string, string>();
  failGet = false;
  failSet = false;
  failRemove = false;

  getItem(key: string): string | null {
    if (this.failGet) throw new Error("get failed");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error("set failed");
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    if (this.failRemove) throw new Error("remove failed");
    this.values.delete(key);
  }
}

function validConfig(): PersonalizationConfigV1 {
  return {
    version: 1,
    themeId: "classic-99",
    heroStyle: "classic",
    glassStyle: "balanced",
    motionStyle: "full",
    readingSize: "default",
    home: { subjectOrder: [...PERSONALIZATION_SUBJECT_IDS] },
  };
}

function envelopeFor(config: unknown, extra: Record<string, unknown> = {}) {
  return {
    cacheVersion: 1,
    savedAt: "2026-09-18T12:00:00Z",
    config,
    ...extra,
  };
}

const userA = "usr_11111111-1111-4111-8111-111111111111";
const userB = "usr_22222222-2222-4222-8222-222222222222";
const legacyUuidUser = "33333333-3333-4333-8333-333333333333";

test("cache keys are scoped, versioned, collision-safe, and email-free", () => {
  const keyA = getPersonalizationCacheKey(userA);
  const keyB = getPersonalizationCacheKey(userB);

  assert.equal(keyA?.startsWith(PERSONALIZATION_CACHE_PREFIX), true);
  assert.notEqual(keyA, keyB);
  assert.equal(keyA?.includes("@"), false);
  assert.equal(getPersonalizationCacheKey("person@example.com"), null);
  assert.equal(getPersonalizationCacheKey(""), null);
  assert.equal(getPersonalizationCacheKey(null), null);
});

test("legacy UUID account IDs remain valid and isolated", async () => {
  const storage = new MemoryStorage();
  const key = getPersonalizationCacheKey(legacyUuidUser);

  assert.equal(key?.startsWith(PERSONALIZATION_CACHE_PREFIX), true);
  assert.equal((await writeCachedPersonalization(legacyUuidUser, validConfig(), storage)).ok, true);
  const result = await readCachedPersonalization(legacyUuidUser, storage);

  assert.equal(result.status, "found");
});

test("missing cache returns Classic 99 without throwing", async () => {
  const result = await readCachedPersonalization(userA, new MemoryStorage());

  assert.equal(result.status, "missing");
  assert.deepEqual(result.config, createDefaultPersonalization());
});

test("A/B account isolation survives reads and removing only account A", async () => {
  const storage = new MemoryStorage();
  const configA = { ...validConfig(), themeId: "emerald" as const };
  const configB = { ...validConfig(), themeId: "midnight" as const };

  assert.equal((await writeCachedPersonalization(userA, configA, storage)).ok, true);
  assert.equal((await writeCachedPersonalization(userB, configB, storage)).ok, true);

  const readA = await readCachedPersonalization(userA, storage);
  const readB = await readCachedPersonalization(userB, storage);
  assert.equal(readA.status, "found");
  assert.equal(readB.status, "found");
  if (readA.status === "found" && readB.status === "found") {
    assert.equal(readA.config.themeId, "emerald");
    assert.equal(readB.config.themeId, "midnight");
  }

  assert.deepEqual(await removeCachedPersonalization(userA, storage), { ok: true });
  const removedA = await readCachedPersonalization(userA, storage);
  const remainingB = await readCachedPersonalization(userB, storage);
  assert.equal(removedA.status, "missing");
  assert.equal(remainingB.status, "found");
});

test("write creates a versioned envelope and snapshots the caller config", async () => {
  const storage = new MemoryStorage();
  const config: PersonalizationConfigV1 = { ...validConfig(), themeId: "ocean" };
  const result = await writeCachedPersonalization(userA, config, storage);

  assert.equal(result.ok, true);
  config.themeId = "rose";

  const read = await readCachedPersonalization(userA, storage);
  assert.equal(read.status, "found");
  if (read.status === "found") {
    assert.equal(read.config.themeId, "ocean");
    assert.match(read.savedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  }

  const raw = storage.values.get(getPersonalizationCacheKey(userA)!);
  assert.ok(raw);
  const envelope = JSON.parse(raw);
  assert.equal(envelope.cacheVersion, 2);
  assert.equal(envelope.config.version, 1);
  assert.equal(envelope.sync.pending, null);
  assert.equal(envelope.sync.lastSyncState, "never");
  assert.equal("userId" in envelope, false);
});

test("reads return fresh config objects", async () => {
  const storage = new MemoryStorage();
  await writeCachedPersonalization(userA, validConfig(), storage);

  const first = await readCachedPersonalization(userA, storage);
  const second = await readCachedPersonalization(userA, storage);
  assert.equal(first.status, "found");
  assert.equal(second.status, "found");
  if (first.status === "found" && second.status === "found") {
    assert.notEqual(first.config, second.config);
    assert.notEqual(first.config.home.subjectOrder, second.config.home.subjectOrder);
    (first.config.home.subjectOrder as string[]).reverse();
    assert.deepEqual(second.config.home.subjectOrder, PERSONALIZATION_SUBJECT_IDS);
  }
});

test("unknown config and envelope fields are not retained", async () => {
  const storage = new MemoryStorage();
  const key = getPersonalizationCacheKey(userA)!;
  storage.values.set(
    key,
    JSON.stringify(
      envelopeFor(
        { ...validConfig(), themeId: "violet", unknownConfigField: "ignored" },
        { unknownEnvelopeField: { ignored: true } },
      ),
    ),
  );

  const result = await readCachedPersonalization(userA, storage);
  assert.equal(result.status, "found");
  if (result.status === "found") {
    assert.equal(result.config.themeId, "violet");
    assert.equal("unknownConfigField" in result.config, false);
    assert.equal("unknownEnvelopeField" in result, false);
  }
});

test("corrupt JSON, malformed envelopes, and unsupported versions return invalid fallback", async () => {
  const cases: Array<{ raw: string; reason: string }> = [
    { raw: "{not-json", reason: "invalid-json" },
    { raw: JSON.stringify({ cacheVersion: 1 }), reason: "invalid-saved-at" },
    { raw: JSON.stringify(envelopeFor(validConfig(), { cacheVersion: 99 })), reason: "unsupported-cache-version" },
    { raw: JSON.stringify(envelopeFor(validConfig(), { savedAt: "yesterday" })), reason: "invalid-saved-at" },
    { raw: JSON.stringify(envelopeFor({ ...validConfig(), version: 99 })), reason: "unsupported-config-version" },
    { raw: JSON.stringify(envelopeFor({ ...validConfig(), themeId: "rainbow" })), reason: "invalid-config" },
    { raw: JSON.stringify(envelopeFor({ ...validConfig(), home: { subjectOrder: ["ID", "NT"] } })), reason: "invalid-config" },
  ];

  for (const item of cases) {
    const storage = new MemoryStorage();
    storage.values.set(getPersonalizationCacheKey(userA)!, item.raw);
    const result = await readCachedPersonalization(userA, storage);
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.reason, item.reason);
      assert.deepEqual(result.config, createDefaultPersonalization());
    }
  }
});

test("oversized cached configs are rejected without throwing", async () => {
  const storage = new MemoryStorage();
  storage.values.set(
    getPersonalizationCacheKey(userA)!,
    JSON.stringify(
      envelopeFor({
        ...validConfig(),
        irrelevant: "x".repeat(16 * 1024),
      }),
    ),
  );

  const result = await readCachedPersonalization(userA, storage);
  assert.equal(result.status, "invalid");
  if (result.status === "invalid") assert.equal(result.reason, "oversized-config");
});

test("storage get, set, and remove failures are structured and nonfatal", async () => {
  const getFailure = new MemoryStorage();
  getFailure.failGet = true;
  const read = await readCachedPersonalization(userA, getFailure);
  assert.deepEqual(read, {
    status: "invalid",
    config: createDefaultPersonalization(),
    reason: "storage-error",
  });

  const setFailure = new MemoryStorage();
  setFailure.failSet = true;
  assert.deepEqual(await writeCachedPersonalization(userA, validConfig(), setFailure), {
    ok: false,
    error: "storage-error",
  });

  const removeFailure = new MemoryStorage();
  removeFailure.failRemove = true;
  assert.deepEqual(await removeCachedPersonalization(userA, removeFailure), {
    ok: false,
    error: "storage-error",
  });
});

test("strict writes reject unknown fields and invalid subject orders", async () => {
  const storage = new MemoryStorage();
  assert.deepEqual(
    await writeCachedPersonalization(userA, { ...validConfig(), appIconId: "night" }, storage),
    { ok: false, error: "invalid-config" },
  );
  assert.deepEqual(
    await writeCachedPersonalization(
      userA,
      { ...validConfig(), home: { subjectOrder: ["ID", "NT"] } },
      storage,
    ),
    { ok: false, error: "invalid-config" },
  );
  assert.equal(storage.values.size, 0);
});