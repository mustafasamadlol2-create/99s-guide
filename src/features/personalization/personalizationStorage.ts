import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import {
  MAX_PERSONALIZATION_PAYLOAD_BYTES,
  PERSONALIZATION_VERSION,
  isPersonalizationPayloadWithinLimit,
  parsePersonalizationConfig,
  type PersonalizationConfigV1,
  normalizePersonalizationConfig,
  validatePersonalizationConfig,
} from "../../../shared/personalization";

export const PERSONALIZATION_CACHE_VERSION = 1 as const;
export const PERSONALIZATION_CACHE_PREFIX = "99s:personalization:v1:";

export type PersonalizationCacheEnvelope = {
  cacheVersion: typeof PERSONALIZATION_CACHE_VERSION;
  savedAt: string;
  config: PersonalizationConfigV1;
};

export type PersonalizationCacheInvalidReason =
  | "invalid-user-id"
  | "invalid-json"
  | "invalid-envelope"
  | "invalid-saved-at"
  | "unsupported-cache-version"
  | "invalid-config"
  | "unsupported-config-version"
  | "oversized-config"
  | "storage-error";

export type PersonalizationCacheReadResult =
  | {
      status: "found";
      config: PersonalizationConfigV1;
      savedAt: string;
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
  | { ok: true; savedAt: string }
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
      if (typeof localStorage === "undefined") {
        throw new Error("localStorage is unavailable");
      }
      return localStorage.getItem(key);
    },
    setItem: (key, value) => {
      if (typeof localStorage === "undefined") {
        throw new Error("localStorage is unavailable");
      }
      localStorage.setItem(key, value);
    },
    removeItem: (key) => {
      if (typeof localStorage === "undefined") {
        throw new Error("localStorage is unavailable");
      }
      localStorage.removeItem(key);
    },
  };
}

function isValidSavedAt(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
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
    home: {
      subjectOrder: home.subjectOrder,
    },
  };
}

function parseCachedConfig(value: unknown):
  | { config: PersonalizationConfigV1 }
  | { reason: PersonalizationCacheInvalidReason } {
  if (!isRecord(value)) return { reason: "invalid-config" };
  if (value.version !== PERSONALIZATION_VERSION) {
    return { reason: "unsupported-config-version" };
  }
  if (!isPersonalizationPayloadWithinLimit(value)) {
    return { reason: "oversized-config" };
  }

  const cleanConfig = stripUnknownConfigFields(value);
  const config = parsePersonalizationConfig(cleanConfig);
  return config ? { config } : { reason: "invalid-config" };
}

function fallbackInvalid(reason: PersonalizationCacheInvalidReason): PersonalizationCacheReadResult {
  return {
    status: "invalid",
    config: normalizePersonalizationConfig(null),
    reason,
  };
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

  if (raw === null) {
    return { status: "missing", config: normalizePersonalizationConfig(null) };
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return fallbackInvalid("invalid-json");
  }

  if (!isRecord(envelope)) return fallbackInvalid("invalid-envelope");
  if (envelope.cacheVersion !== PERSONALIZATION_CACHE_VERSION) {
    return fallbackInvalid("unsupported-cache-version");
  }
  if (!isValidSavedAt(envelope.savedAt)) {
    return fallbackInvalid("invalid-saved-at");
  }

  const parsedConfig = parseCachedConfig(envelope.config);
  if ("reason" in parsedConfig) return fallbackInvalid(parsedConfig.reason);

  return {
    status: "found",
    config: normalizePersonalizationConfig(parsedConfig.config),
    savedAt: envelope.savedAt,
  };
}

export async function writeCachedPersonalization(
  userId: unknown,
  config: unknown,
  storage: PersonalizationKeyValueStorage = createDefaultStorage(),
): Promise<PersonalizationCacheWriteResult> {
  const key = getPersonalizationCacheKey(userId);
  if (!key) return { ok: false, error: "invalid-user-id" };

  const validation = validatePersonalizationConfig(config);
  if (!validation.success) {
    return { ok: false, error: "invalid-config" };
  }
  if (!isPersonalizationPayloadWithinLimit(validation.data)) {
    return { ok: false, error: "oversized-config" };
  }

  const savedAt = new Date().toISOString();
  const envelope: PersonalizationCacheEnvelope = {
    cacheVersion: PERSONALIZATION_CACHE_VERSION,
    savedAt,
    config: normalizePersonalizationConfig(validation.data),
  };

  try {
    await storage.setItem(key, JSON.stringify(envelope));
    return { ok: true, savedAt };
  } catch {
    return { ok: false, error: "storage-error" };
  }
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

export { MAX_PERSONALIZATION_PAYLOAD_BYTES };