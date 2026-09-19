import assert from "node:assert/strict";
import test from "node:test";
import {
  PERSONALIZATION_SUBJECT_IDS,
  type PersonalizationCloudRecord,
  type PersonalizationConfigV1,
} from "../shared/personalization.js";
import {
  readCachedPersonalization,
  writeCachedPersonalization,
  writePendingPersonalization,
  type PersonalizationKeyValueStorage,
} from "../src/features/personalization/personalizationStorage.js";
import { reconcilePersonalization } from "../src/features/personalization/personalizationCloudSync.js";

class MemoryStorage implements PersonalizationKeyValueStorage {
  values = new Map<string, string>();
  failSet = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failSet) throw new Error("set failed");
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
}

const userId = "usr_sync-test";
const config: PersonalizationConfigV1 = {
  version: 1,
  themeId: "violet",
  heroStyle: "aurora",
  glassStyle: "frosted",
  motionStyle: "subtle",
  readingSize: "large",
  home: { subjectOrder: [...PERSONALIZATION_SUBJECT_IDS].reverse() },
};

function record(overrides: Partial<PersonalizationCloudRecord> = {}): PersonalizationCloudRecord {
  return {
    config,
    revision: "opaque-revision",
    updatedAt: "2026-09-19T00:00:00.000Z",
    lastIntentId: "pi_existing-intent",
    ...overrides,
  };
}

test("V1 migration rewrites one active key to V2 while retaining legacy provenance", async () => {
  const storage = new MemoryStorage();
  const key = "99s:personalization:v1:" + encodeURIComponent(userId);
  storage.values.set(key, JSON.stringify({
    cacheVersion: 1,
    savedAt: "2026-09-18T12:00:00.000Z",
    config,
  }));

  const migrated = await readCachedPersonalization(userId, storage);
  assert.equal(migrated.status, "found");
  assert.equal(migrated.migrated, true);
  assert.equal(migrated.envelope?.cacheVersion, 2);
  assert.equal(migrated.envelope?.sync.knownCloudRevision, null);
  assert.equal(migrated.envelope?.sync.pending, null);

  const restarted = await readCachedPersonalization(userId, storage);
  assert.equal(restarted.status, "found");
  assert.equal(restarted.envelope?.sync.lastSyncState, "never");
  const emptyDecision = reconcilePersonalization(restarted, { status: "empty", record: null });
  assert.equal(emptyDecision.action, "confirm");
});

test("missing local defaults do not become a V2 cache on an empty cloud", async () => {
  const storage = new MemoryStorage();
  const local = await readCachedPersonalization(userId, storage);
  assert.equal(local.status, "missing");
  const decision = reconcilePersonalization(local, { status: "empty", record: null });
  assert.deepEqual(decision, { action: "none" });
  assert.equal(storage.values.size, 0);
});

test("pending local intent takes precedence over every remote result", async () => {
  const storage = new MemoryStorage();
  const pending = await writePendingPersonalization(userId, config, null, storage, "pi_pending-intent");
  assert.equal(pending.ok, true);
  const local = await readCachedPersonalization(userId, storage);
  assert.equal(local.status, "found");
  const decision = reconcilePersonalization(local, {
    status: "ok",
    record: record({ config: { ...config, themeId: "ocean" }, revision: "remote" }),
  });
  assert.equal(decision.action, "upload-pending");
  if (decision.action === "upload-pending") assert.equal(decision.pending.intentId, "pi_pending-intent");
});

test("same config with an opaque new revision adopts identity without a confirmation", async () => {
  const storage = new MemoryStorage();
  const saved = await writeCachedPersonalization(userId, config, storage);
  assert.equal(saved.ok, true);
  const localWithCleanState = await readCachedPersonalization(userId, storage);
  assert.equal(localWithCleanState.status, "found");
  // A clean envelope is the state after a prior acknowledgement.
  const clean = {
    ...localWithCleanState,
    envelope: {
      ...localWithCleanState.envelope!,
      sync: {
        ...localWithCleanState.envelope!.sync,
        pending: null,
        knownCloudRevision: "old-opaque-value",
        lastSyncState: "clean" as const,
      },
    },
  };
  const decision = reconcilePersonalization(clean, { status: "ok", record: record({ revision: "new-opaque-value" }) });
  assert.equal(decision.action, "adopt");
});

test("different config and revision requires confirmation rather than ordering revisions", async () => {
  const storage = new MemoryStorage();
  const saved = await writeCachedPersonalization(userId, config, storage);
  assert.equal(saved.ok, true);
  const local = await readCachedPersonalization(userId, storage);
  assert.equal(local.status, "found");
  const clean = {
    ...local,
    envelope: {
      ...local.envelope!,
      sync: {
        ...local.envelope!.sync,
        pending: null,
        knownCloudRevision: "old-opaque-value",
        lastSyncState: "clean" as const,
      },
    },
  };
  const decision = reconcilePersonalization(clean, {
    status: "ok",
    record: record({ config: { ...config, themeId: "ocean" }, revision: "0000000000000000000000000000000000000000000000000000000000000000" }),
  });
  assert.equal(decision.action, "confirm");
});