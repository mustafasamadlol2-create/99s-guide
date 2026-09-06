import { Preferences } from "@capacitor/preferences";
import { Capacitor } from "@capacitor/core";
import { SecureStorage as NativeSecureStorage } from "@aparajita/capacitor-secure-storage";
import { IDBManager } from "./indexedDB";

const webSessionTokens = new Map<string, string>();

function isSensitiveStorageKey(key: string): boolean {
  return key === "auth_token" || key.startsWith("oauth_pkce_");
}

function isWebSessionKey(key: string): boolean {
  return isSensitiveStorageKey(key);
}

function readWebSessionToken(key: string): string | null {
  const memoryToken = webSessionTokens.get(key);
  if (memoryToken) return memoryToken;

  try {
    if (key === "auth_token") {
      const lsToken = localStorage.getItem(key);
      if (lsToken) return lsToken;
    }
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeWebSessionToken(key: string, value: string): void {
  webSessionTokens.set(key, value);
  try {
    if (key === "auth_token") localStorage.setItem(key, value);
    else sessionStorage.setItem(key, value);
  } catch {}
}

function removeWebSessionToken(key: string): void {
  webSessionTokens.delete(key);
  try {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  } catch {}
}

async function migrateLegacyNativeSensitiveValue(key: string): Promise<string | null> {
  let legacyValue: string | null = null;

  try {
    const pref = await Preferences.get({ key });
    if (typeof pref.value === "string" && pref.value.trim()) {
      legacyValue = pref.value;
    }
  } catch {}

  if (!legacyValue) {
    try {
      const local = localStorage.getItem(key);
      if (typeof local === "string" && local.trim()) legacyValue = local;
    } catch {}
  }

  if (!legacyValue) return null;

  try {
    await NativeSecureStorage.set(key, legacyValue);
    try {
      await Preferences.remove({ key });
    } catch {}
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {}
    console.log("[SECURE-STORAGE] Migrated legacy native sensitive key", key);
    return legacyValue;
  } catch (error) {
    console.error("[SECURE-STORAGE] Failed to migrate native sensitive key", key, error);
    return null;
  }
}

export const SecureStorage = {
  async set(key: string, value: string) {
    if (Capacitor.isNativePlatform() && isSensitiveStorageKey(key)) {
      await NativeSecureStorage.set(key, value);
      try {
        await Preferences.remove({ key });
      } catch {}
      try {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      } catch {}
      return;
    }

    if (!Capacitor.isNativePlatform() && isWebSessionKey(key)) {
      writeWebSessionToken(key, value);
      if (key !== "auth_token") {
        try {
          await Preferences.set({ key, value });
        } catch {}
      }
      return;
    }

    if (!Capacitor.isNativePlatform()) {
      try {
        await IDBManager.setItem(key, value);
        return;
      } catch {}
    }

    try {
      await Preferences.set({ key, value });
    } catch {}
  },

  async get(key: string): Promise<string | null> {
    if (Capacitor.isNativePlatform() && isSensitiveStorageKey(key)) {
      try {
        const value = await NativeSecureStorage.get(key);
        if (typeof value === "string" && value.trim()) return value;
      } catch (error) {
        console.error("[SECURE-STORAGE] Native secure read failed", key, error);
      }

      // Important for existing installs: older builds may have stored auth_token
      // in Preferences/localStorage before Keychain-backed storage was introduced.
      return migrateLegacyNativeSensitiveValue(key);
    }

    if (!Capacitor.isNativePlatform() && isWebSessionKey(key)) {
      const memoryToken = readWebSessionToken(key);
      if (memoryToken) return memoryToken;
      try {
        const { value } = await Preferences.get({ key });
        if (value) {
          writeWebSessionToken(key, value);
          return value;
        }
      } catch {}
      return null;
    }

    let val: string | null = null;
    try {
      val = localStorage.getItem(key);
    } catch {}

    if (val) {
      await this.set(key, val);
      try {
        localStorage.removeItem(key);
      } catch {}
      return val;
    }

    if (!Capacitor.isNativePlatform()) {
      try {
        val = await IDBManager.getItem<string>(key);
        if (val) return val;
      } catch {}
    }

    try {
      const { value } = await Preferences.get({ key });
      return value;
    } catch {
      return null;
    }
  },

  async remove(key: string) {
    if (Capacitor.isNativePlatform() && isSensitiveStorageKey(key)) {
      try {
        await NativeSecureStorage.remove(key);
      } finally {
        try {
          await Preferences.remove({ key });
        } catch {}
        try {
          localStorage.removeItem(key);
          sessionStorage.removeItem(key);
        } catch {}
      }
      return;
    }

    if (!Capacitor.isNativePlatform() && isWebSessionKey(key)) {
      removeWebSessionToken(key);
      try {
        await Preferences.remove({ key });
      } catch {}
      return;
    }

    if (!Capacitor.isNativePlatform()) {
      try {
        await IDBManager.removeItem(key);
      } catch {}
    }

    try {
      await Preferences.remove({ key });
    } catch {}
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};
