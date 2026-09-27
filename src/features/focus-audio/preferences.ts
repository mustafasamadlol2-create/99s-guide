import { Capacitor } from "@capacitor/core";
import { Preferences as CapacitorPreferences } from "@capacitor/preferences";
import { z } from "zod";
import {
  DEFAULT_FOCUS_AUDIO_PREFERENCES,
  FOCUS_AUDIO_PREFERENCES_KEY,
  FOCUS_AUDIO_PREFERENCES_MAX_BYTES,
  FOCUS_AUDIO_PREFERENCES_VERSION,
} from "./constants";
import type { AmbientTrackId, FocusAudioPreferences, FocusAudioSourceType } from "./types";

export interface FocusAudioPreferenceStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem?(key: string): void | Promise<void>;
}

const preferencesSchema = z.object({
  version: z.literal(FOCUS_AUDIO_PREFERENCES_VERSION),
  volume: z.number().finite(),
  ambientTrackId: z.string().min(1).max(100).nullable(),
  userAudioLoop: z.boolean(),
  lastSourceType: z.enum(["NONE", "AMBIENT", "USER_AUDIO"]),
  pauseOnFocusEnd: z.boolean(),
}).strict();

function defaultStorage(): FocusAudioPreferenceStorage {
  if (Capacitor.isNativePlatform()) {
    return {
      getItem: async (key) => (await CapacitorPreferences.get({ key })).value,
      setItem: async (key, value) => CapacitorPreferences.set({ key, value }),
      removeItem: async (key) => CapacitorPreferences.remove({ key }),
    };
  }
  return {
    getItem: (key) => {
      if (typeof localStorage === "undefined") throw new Error("Local preference storage is unavailable.");
      return localStorage.getItem(key);
    },
    setItem: (key, value) => {
      if (typeof localStorage === "undefined") throw new Error("Local preference storage is unavailable.");
      localStorage.setItem(key, value);
    },
    removeItem: (key) => {
      if (typeof localStorage === "undefined") throw new Error("Local preference storage is unavailable.");
      localStorage.removeItem(key);
    },
  };
}

function safeVolume(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function parseFocusAudioPreferences(
  serialized: string | null,
  validAmbientTrackIds: ReadonlySet<AmbientTrackId> = new Set(),
): FocusAudioPreferences {
  if (!serialized || new TextEncoder().encode(serialized).byteLength > FOCUS_AUDIO_PREFERENCES_MAX_BYTES) {
    return DEFAULT_FOCUS_AUDIO_PREFERENCES;
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return DEFAULT_FOCUS_AUDIO_PREFERENCES;
  }
  const parsed = preferencesSchema.safeParse(value);
  if (!parsed.success) return DEFAULT_FOCUS_AUDIO_PREFERENCES;
  return {
    ...parsed.data,
    volume: safeVolume(parsed.data.volume),
    ambientTrackId: parsed.data.ambientTrackId &&
      validAmbientTrackIds.has(parsed.data.ambientTrackId)
      ? parsed.data.ambientTrackId
      : null,
  };
}

export function createFocusAudioPreferenceRepository(options: {
  storage?: FocusAudioPreferenceStorage;
  validAmbientTrackIds?: ReadonlySet<AmbientTrackId>;
} = {}) {
  const storage = options.storage ?? defaultStorage();
  const validAmbientTrackIds = options.validAmbientTrackIds ?? new Set<AmbientTrackId>();

  return {
    async load(): Promise<FocusAudioPreferences> {
      try {
        return parseFocusAudioPreferences(
          await storage.getItem(FOCUS_AUDIO_PREFERENCES_KEY),
          validAmbientTrackIds,
        );
      } catch {
        return DEFAULT_FOCUS_AUDIO_PREFERENCES;
      }
    },
    async save(value: FocusAudioPreferences): Promise<boolean> {
      const parsed = preferencesSchema.safeParse(value);
      if (!parsed.success) return false;
      const safe: FocusAudioPreferences = {
        ...parsed.data,
        volume: safeVolume(parsed.data.volume),
        ambientTrackId: parsed.data.ambientTrackId &&
          validAmbientTrackIds.has(parsed.data.ambientTrackId)
          ? parsed.data.ambientTrackId
          : null,
      };
      try {
        const serialized = JSON.stringify(safe);
        if (new TextEncoder().encode(serialized).byteLength > FOCUS_AUDIO_PREFERENCES_MAX_BYTES) return false;
        await storage.setItem(FOCUS_AUDIO_PREFERENCES_KEY, serialized);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function isFocusAudioSourceType(value: unknown): value is FocusAudioSourceType {
  return value === "NONE" || value === "AMBIENT" || value === "USER_AUDIO";
}