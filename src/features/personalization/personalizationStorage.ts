import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import {
  MAX_PERSONALIZATION_CLOUD_RECORD_BYTES,
  MAX_PERSONALIZATION_LOCAL_ENVELOPE_BYTES,
  MAX_PERSONALIZATION_PAYLOAD_BYTES,
  PERSONALIZATION_VERSION,
  isPersonalizationPayloadWithinLimit,
  parsePersonalizationConfig,
  type PersonalizationCloudRecord,
  type PersonalizationConfigV1,
  type PersonalizationLocalEnvelopeV2,
  type PersonalizationPendingIntent,
  type PersonalizationSyncState,
  normalizePersonalizationConfig,
  validatePersonalizationConfig,
} from "../../../shared/personalization";

export const PERSONALIZATION_CACHE_VERSION = 2 as const;
export const PERSONALIZATION_CACHE_PREFIX = "99s:personalization:v1:";

export type PersonalizationCacheEnvelope = PersonalizationLocalEnvelopeV2;

export type PersonalizationCacheInvalidReason =
  | "invalid-user-id"
  | "invalid-json"
  | "invalid-envelope"
  | "invalid-saved-at"
  | "unsupported-cache-version"
  | "invalid-config"
  | "unsupported-config-version"
  | "oversized-config"
  | "oversized-envelope"
  | "invalid-sync"
  | "storage-error";

export type PersonalizationCacheReadResult =
  | {
      status: "found";
      config: PersonalizationConfigV1;
      savedAt: string;
      envelope?: PersonalizationLocalEnvelopeV2;
      migrated?: boolean;
    }
  | {
      status: "missing";
      config: PersonalizationConfigV1;
    }
  | {
      status: "invalid";
      config: PersonalizationConfigV1;
      reason: PersonalizationCacheInvalidReason;
    };

export type PersonalizationCacheWriteResult =
  | { ok: true; savedAt: string; envelope: PersonalizationLocalEnvelopeV2 }
  | { ok: false; error: PersonalizationCacheInvalidReason };

export type PersonalizationCacheRemoveResult =
  | { ok: true }
  | { ok: false; error: "invalid-user-id" | "storage-error" };

export interface PersonalizationKeyValueStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

const SAFE_USER_ID =
  /^(?:usr_[A-Za-z0-9-]{1,120}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const INTENT_ID = /^[A-Za-z0-9._:-]{8,160}$/;

export function getPersonalizationCacheKey(userId: unknown): string | null {
  if (typeof userId !== "string") return null;
  const normalizedUserId = userId.trim();
  if (!SAFE_USER_ID.test(normalizedUserId) || normalizedUserId.includes("@")) {
    return null;
  }
  return `${PERSONALIZATION_CACHE_PREFIX}${encodeURIComponent(normalizedUserId)}`;
}

function createDefaultStorage(): PersonalizationKeyValueStorage {
  if (Capacitor.isNativePlatform()) {
    return {
      getItem: async (key) => (await Preferences.get({ key })).value,
      setItem: async (key, value) => {
        await Preferences.set({ key, value });
      },
      removeItem: async (key) => {
        await Preferences.remove({ key });
      },
    };
  }

  return {
    getItem: (key) => {
      if (typeof localStorage === "undefined") throw new Error("localStorage is unavailable");
      return localStorage.getItem(key);
    },
    setItem: (key, value) => {
      if (typeof localStorage === "undefined") throw new Error("localStorage is unavailable");
      localStorage.setItem(key, value);
    },
    removeItem: (key) => {
      if (typeof localStorage === "undefined") throw new Error("localStorage is unavailable");
      localStorage.removeItem(key);
    },
  };
}

function isValidSavedAt(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripUnknownConfigFields(value: Record<string, unknown>): Record<string, unknown> {
  const home = isRecord(value.home) ? value.home : {};
  return {
    version: value.version,
    themeId: value.themeId,
    heroStyle: value.heroStyle,
    glassStyle: value.glassStyle,
    motionStyle: value.motionStyle,
    readingSize: value.readingSize,
    home: { subjectOrder: home.subjectOrder },
  };
}

function parseCachedConfig(value: unknown):
  | { config: PersonalizationConfigV1 }
  | { reason: PersonalizationCacheInvalidReason } {
  if (!isRecord(value)) return { reason: "invalid-config" };
  if (value.version !== PERSONALIZATION_VERSION) return { reason: "unsupported-config-version" };
  if (!isPersonalizationPayloadWithinLimit(value)) return { reason: "oversized-config" };
  const config = parsePersonalizationConfig(stripUnknownConfigFields(value));
  return config ? { config } : { reason: "invalid-config" };
}

function cloneConfig(config: PersonalizationConfigV1): PersonalizationConfigV1 {
  return normalizePersonalizationConfig(config);
}

function createCleanEnvelope(
  config: PersonalizationConfigV1,
  options: Partial<PersonalizationLocalEnvelopeV2["sync"]> = {},
): PersonalizationLocalEnvelopeV2 {
  return {
    cacheVersion: 2,
    savedAt: new Date().toISOString(),
    config: cloneConfig(config),
    sync: {
      knownCloudRevision: options.knownCloudRevision ?? null,
      pending: options.pending ?? null,
      lastSyncState: options.lastSyncState ?? "never",
      lastSuccessfulGetAt: options.lastSuccessfulGetAt ?? null,
    },
  };
}

export function createPersonalizationEnvelope(
  config: PersonalizationConfigV1,
  sync: Partial<PersonalizationLocalEnvelopeV2["sync"]> = {},
): PersonalizationLocalEnvelopeV2 {
  return createCleanEnvelope(config, sync);
}

function parseSync(value: unknown):
  | { sync: PersonalizationLocalEnvelopeV2["sync"] }
  | { reason: PersonalizationCacheInvalidReason } {
  if (!isRecord(value)) return { reason: "invalid-sync" };
  const knownCloudRevision = value.knownCloudRevision;
  const lastSuccessfulGetAt = value.lastSuccessfulGetAt;
  const pendingValue = value.pending;
  if (knownCloudRevision !== null && typeof knownCloudRevision !== "string") return { reason: "invalid-sync" };
  if (lastSuccessfulGetAt !== null && !isValidSavedAt(lastSuccessfulGetAt)) return { reason: "invalid-sync" };
  if (!["never", "clean", "retryable-failure", "disabled", "unsupported"].includes(String(value.lastSyncState))) {
    return { reason: "invalid-sync" };
  }

  let pending: PersonalizationPendingIntent | null = null;
  if (pendingValue !== null) {
    if (!isRecord(pendingValue) || typeof pendingValue.intentId !== "string" ||
        !INTENT_ID.test(pendingValue.intentId) || !isValidSavedAt(pendingValue.createdAt)) {
      return { reason: "invalid-sync" };
    }
    const parsed = parseCachedConfig(pendingValue.config);
    if ("reason" in parsed) return { reason: "invalid-sync" };
    pending = { intentId: pendingValue.intentId, config: parsed.config, createdAt: pendingValue.createdAt };
  }

  return {
    sync: {
      knownCloudRevision: knownCloudRevision as string | null,
      pending,
      lastSyncState: value.lastSyncState as PersonalizationSyncState,
      lastSuccessfulGetAt: lastSuccessfulGetAt as string | null,
    },
  };
}

function parseV2Envelope(value: Record<string, unknown>):
  | { envelope: PersonalizationLocalEnvelopeV2 }
  | { reason: PersonalizationCacheInvalidReason } {
  if (value.cacheVersion !== 2 || !isValidSavedAt(value.savedAt)) {
    return { reason: value.cacheVersion === 2 ? "invalid-saved-at" : "unsupported-cache-version" };
  }
  const parsedConfig = parseCachedConfig(value.config);
  if ("reason" in parsedConfig) return { reason: parsedConfig.reason };
  const parsedSync = parseSync(value.sync);
  if ("reason" in parsedSync) return { reason: parsedSync.reason };
  const envelope: PersonalizationLocalEnvelopeV2 = {
    cacheVersion: 2,
    savedAt: value.savedAt,
    config: parsedConfig.config,
    sync: parsedSync.sync,
  };
  try {
    return new TextEncoder().encode(JSON.stringify(envelope)).byteLength <= MAX_PERSONALIZATION_LOCAL_ENVELOPE_BYTES
      ? { envelope }
      : { reason: "oversized-envelope" };
  } catch {
    return { reason: "invalid-envelope" };
  }
}

function fallbackInvalid(reason: PersonalizationCacheInvalidReason): PersonalizationCacheReadResult {
  return { status: "invalid", config: normalizePersonalizationConfig(null), reason };
}

function serializeEnvelope(envelope: PersonalizationLocalEnvelopeV2): string | null {
  try {
    const serialized = JSON.stringify(envelope);
    return serialized && serialized.length >= 0 && new TextEncoder().encode(serialized).byteLength <= MAX_PERSONALIZATION_LOCAL_ENVELOPE_BYTES
      ? serialized
      : null;
  } catch {
    return null;
  }
}

export async function readCachedPersonalization(
  userId: unknown,
  storage: PersonalizationKeyValueStorage = createDefaultStorage(),
): Promise<PersonalizationCacheReadResult> {
  const key = getPersonalizationCacheKey(userId);
  if (!key) return fallbackInvalid("invalid-user-id");
  let raw: string | null;
  try {
    raw = await storage.getItem(key);
  } catch {
    return fallbackInvalid("storage-error");
  }
  if (raw === null) return { status: "missing", config: normalizePersonalizationConfig(null) };
  try {
    if (new TextEncoder().encode(raw).byteLength > MAX_PERSONALIZATION_LOCAL_ENVELOPE_BYTES) {
      return fallbackInvalid("oversized-envelope");
    }
  } catch {
    return fallbackInvalid("invalid-envelope");
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fallbackInvalid("invalid-json");
  }
  if (!isRecord(value)) return fallbackInvalid("invalid-envelope");

  let envelope: PersonalizationLocalEnvelopeV2;
  let migrated = false;
  if (value.cacheVersion === 1) {
    if (!isValidSavedAt(value.savedAt)) return fallbackInvalid("invalid-saved-at");
    const parsedConfig = parseCachedConfig(value.config);
    if ("reason" in parsedConfig) return fallbackInvalid(parsedConfig.reason);
    envelope = {
      cacheVersion: 2,
      savedAt: value.savedAt,
      config: parsedConfig.config,
      sync: {
        knownCloudRevision: null,
        pending: null,
        lastSyncState: "never",
        lastSuccessfulGetAt: null,
      },
    };
    migrated = true;
    const serialized = serializeEnvelope(envelope);
    if (serialized) {
      try {
        await storage.setItem(key, serialized);
      } catch {
        // The validated V1 value remains usable for this session. A later
        // natural V2 write can retry the opportunistic migration.
      }
    }
  } else {
    const parsed = parseV2Envelope(value);
    if ("reason" in parsed) return fallbackInvalid(parsed.reason);
    envelope = parsed.envelope;
  }

  return {
    status: "found",
    config: cloneConfig(envelope.config),
    savedAt: envelope.savedAt,
    envelope: {
      ...envelope,
      config: cloneConfig(envelope.config),
      sync: {
        ...envelope.sync,
        pending: envelope.sync.pending
          ? { ...envelope.sync.pending, config: cloneConfig(envelope.sync.pending.config) }
          : null,
      },
    },
    migrated,
  };
}

export async function writePersonalizationEnvelope(
  userId: unknown,
  envelope: PersonalizationLocalEnvelopeV2,
  storage: PersonalizationKeyValueStorage = createDefaultStorage(),
): Promise<PersonalizationCacheWriteResult> {
  const key = getPersonalizationCacheKey(userId);
  if (!key) return { ok: false, error: "invalid-user-id" };
  const parsed = parseV2Envelope(envelope as unknown as Record<string, unknown>);
  if ("reason" in parsed) return { ok: false, error: parsed.reason };
  const serialized = serializeEnvelope(parsed.envelope);
  if (!serialized) return { ok: false, error: "oversized-envelope" };
  try {
    await storage.setItem(key, serialized);
    return { ok: true, savedAt: parsed.envelope.savedAt, envelope: parsed.envelope };
  } catch {
    return { ok: false, error: "storage-error" };
  }
}

export async function writePendingPersonalization(
  userId: unknown,
  config: unknown,
  current: PersonalizationLocalEnvelopeV2 | null,
  storage: PersonalizationKeyValueStorage = createDefaultStorage(),
  intentId = createPersonalizationIntentId(),
): Promise<PersonalizationCacheWriteResult> {
  const validation = validatePersonalizationConfig(config);
  if (!validation.success) return { ok: false, error: "invalid-config" };
  if (!INTENT_ID.test(intentId)) return { ok: false, error: "invalid-sync" };
  const pending: PersonalizationPendingIntent = {
    intentId,
    config: cloneConfig(validation.data),
    createdAt: new Date().toISOString(),
  };
  const envelope = createCleanEnvelope(validation.data, {
    knownCloudRevision: current?.sync.knownCloudRevision ?? null,
    pending,
    lastSyncState: current?.sync.lastSyncState ?? "never",
    lastSuccessfulGetAt: current?.sync.lastSuccessfulGetAt ?? null,
  });
  return writePersonalizationEnvelope(userId, envelope, storage);
}

export async function writeCachedPersonalization(
  userId: unknown,
  config: unknown,
  storage: PersonalizationKeyValueStorage = createDefaultStorage(),
): Promise<PersonalizationCacheWriteResult> {
  const validation = validatePersonalizationConfig(config);
  if (!validation.success) return { ok: false, error: "invalid-config" };
  return writePersonalizationEnvelope(userId, createCleanEnvelope(validation.data), storage);
}

export async function acknowledgePersonalizationCloudRecord(
  userId: unknown,
  record: PersonalizationCloudRecord,
  current: PersonalizationLocalEnvelopeV2,
  storage: PersonalizationKeyValueStorage = createDefaultStorage(),
): Promise<PersonalizationCacheWriteResult> {
  const parsed = parseCachedConfig(record.config);
  if ("reason" in parsed || !record.revision || !isValidSavedAt(record.updatedAt) || !INTENT_ID.test(record.lastIntentId)) {
    return { ok: false, error: "invalid-sync" };
  }
  if (record.recordVersion !== 1) {
    return { ok: false, error: "invalid-sync" };
  }
  const envelope = createCleanEnvelope(parsed.config, {
    knownCloudRevision: record.revision,
    pending: null,
    lastSyncState: "clean",
    lastSuccessfulGetAt: current.sync.lastSuccessfulGetAt,
  });
  return writePersonalizationEnvelope(userId, envelope, storage);
}

export function createPersonalizationIntentId(): string {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `pi_${uuid}`;
}

export async function removeCachedPersonalization(
  userId: unknown,
  storage: PersonalizationKeyValueStorage = createDefaultStorage(),
): Promise<PersonalizationCacheRemoveResult> {
  const key = getPersonalizationCacheKey(userId);
  if (!key) return { ok: false, error: "invalid-user-id" };
  try {
    await storage.removeItem(key);
    return { ok: true };
  } catch {
    return { ok: false, error: "storage-error" };
  }
}

export {
  MAX_PERSONALIZATION_PAYLOAD_BYTES,
  MAX_PERSONALIZATION_LOCAL_ENVELOPE_BYTES,
  MAX_PERSONALIZATION_CLOUD_RECORD_BYTES,
};