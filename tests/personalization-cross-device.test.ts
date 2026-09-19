import assert from "node:assert/strict";
import test from "node:test";
import worker from "../cloudflare-personalization-api/src/index.js";
import {
  PERSONALIZATION_SUBJECT_IDS,
  type PersonalizationConfigV2,
} from "../shared/personalization.js";
import {
  acknowledgePersonalizationCloudRecord,
  createPersonalizationEnvelope,
  readCachedPersonalization,
  writePendingPersonalization,
} from "../src/features/personalization/personalizationStorage.js";
import { reconcilePersonalization } from "../src/features/personalization/personalizationCloudSync.js";
import {
  getPersonalizationFromCloud,
  putPersonalizationToCloud,
} from "../server/services/personalizationSync.js";
import type { PersonalizationKeyValueStorage } from "../src/features/personalization/personalizationStorage.js";

class MemoryStorage implements PersonalizationKeyValueStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

class MemoryKv {
  readonly values = new Map<string, string>();
  async get(key: string) {
    const raw = this.values.get(key);
    return raw ? JSON.parse(raw) : null;
  }
  async put(key: string, value: string) {
    this.values.set(key, value);
  }
}

const secret = "cross-device-secret";
const userId = "usr_cross-device";
const configA: PersonalizationConfigV2 = {
  version: 2,
  themeId: "ocean",
  heroStyle: "aurora",
  glassStyle: "frosted",
  motionStyle: "subtle",
  readingSize: "large",
  home: {
    subjectOrder: [...PERSONALIZATION_SUBJECT_IDS].reverse(),
    hiddenSubjectIds: ["NT"],
    semesterVisibility: { semester1: true, semester2: false },
  },
};
const configB: PersonalizationConfigV2 = { ...configA, themeId: "violet" };

test("Device A → Worker/KV → Device B → later divergent reconciliation", async () => {
  const kv = new MemoryKv();
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.PERSONALIZATION_WORKER_URL;
  const originalSecret = process.env.PERSONALIZATION_SYNC_SECRET;
  process.env.PERSONALIZATION_WORKER_URL = "https://worker.invalid";
  process.env.PERSONALIZATION_SYNC_SECRET = secret;
  globalThis.fetch = async (input, init) => worker.fetch(
    new Request(String(input), init),
    {
      PERSONALIZATION_KV: kv,
      PERSONALIZATION_SYNC_SECRET: secret,
    },
  );

  try {
    const deviceA = new MemoryStorage();
    const deviceB = new MemoryStorage();
    const pendingA = await writePendingPersonalization(
      userId,
      configA,
      null,
      deviceA,
      "pi-cross-device-a",
    );
    assert.equal(pendingA.ok, true);
    if (!pendingA.ok) return;

    const putA = await putPersonalizationToCloud(userId, {
      config: pendingA.envelope.sync.pending!.config,
      intentId: pendingA.envelope.sync.pending!.intentId,
      knownRevision: null,
    });
    assert.equal(putA.status, "ok");
    if (putA.status !== "ok") return;
    assert.equal(
      (await acknowledgePersonalizationCloudRecord(
        userId,
        putA.record,
        pendingA.envelope,
        deviceA,
      )).ok,
      true,
    );

    const remoteForB = await getPersonalizationFromCloud(userId);
    assert.equal(remoteForB.status, "ok");
    if (remoteForB.status !== "ok") return;
    const adoptedB = await acknowledgePersonalizationCloudRecord(
      userId,
      remoteForB.record,
      createPersonalizationEnvelope(remoteForB.record.config),
      deviceB,
    );
    assert.equal(adoptedB.ok, true);

    const pendingB = await writePendingPersonalization(
      userId,
      configB,
      adoptedB.ok ? adoptedB.envelope : null,
      deviceB,
      "pi-cross-device-b",
    );
    assert.equal(pendingB.ok, true);
    if (!pendingB.ok) return;
    const putB = await putPersonalizationToCloud(userId, {
      config: pendingB.envelope.sync.pending!.config,
      intentId: pendingB.envelope.sync.pending!.intentId,
      knownRevision: pendingB.envelope.sync.knownCloudRevision,
    });
    assert.equal(putB.status, "ok");
    if (putB.status !== "ok") return;

    const localA = await readCachedPersonalization(userId, deviceA);
    assert.equal(localA.status, "found");
    const remoteForA = await getPersonalizationFromCloud(userId);
    assert.equal(remoteForA.status, "ok");
    if (localA.status === "found" && remoteForA.status === "ok") {
      const decision = reconcilePersonalization(localA, remoteForA);
      assert.equal(decision.action, "confirm");
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.PERSONALIZATION_WORKER_URL;
    else process.env.PERSONALIZATION_WORKER_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.PERSONALIZATION_SYNC_SECRET;
    else process.env.PERSONALIZATION_SYNC_SECRET = originalSecret;
  }
});