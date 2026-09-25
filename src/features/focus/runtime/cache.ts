import { accountStorageKey } from "../../../core/storage/accountData";
import type { FocusSessionDto } from "../../../../server/features/focus/types";
import {
  FOCUS_SESSION_STATES,
  FOCUS_TERMINAL_STATES,
} from "../../../../server/features/study-core/focus";
import { isValidServerTimestamp } from "./clock";

export const FOCUS_RUNTIME_CACHE_KEY = "focus_runtime_cache_v1";
export const FOCUS_RUNTIME_CACHE_VERSION = 1 as const;
export const NON_AUTHORITATIVE = "NON_AUTHORITATIVE" as const;

export interface FocusRuntimeCacheEntry {
  version: typeof FOCUS_RUNTIME_CACHE_VERSION;
  authority: typeof NON_AUTHORITATIVE;
  serverNow: string;
  savedAt: string;
  session: FocusSessionDto | null;
}

export interface FocusRuntimeCache {
  read(): FocusRuntimeCacheEntry | null;
  write(entry: FocusRuntimeCacheEntry): void;
  clear(): void;
}

export interface FocusCacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCachedSession(value: unknown): value is FocusSessionDto {
  if (!isRecord(value)) return false;
  const nullableTimestamp = (item: unknown) =>
    item === null || isValidServerTimestamp(item);
  const nullableNumber = (item: unknown) =>
    item === null || (typeof item === "number" && Number.isSafeInteger(item) && item >= 0);

  return typeof value.id === "string" &&
    typeof value.planId === "string" &&
    typeof value.planItemId === "string" &&
    typeof value.lectureId === "string" &&
    typeof value.status === "string" &&
    FOCUS_SESSION_STATES.includes(value.status as FocusSessionDto["status"]) &&
    !FOCUS_TERMINAL_STATES.includes(value.status as (typeof FOCUS_TERMINAL_STATES)[number]) &&
    isValidServerTimestamp(value.serverNow) &&
    nullableTimestamp(value.startedAt) &&
    nullableTimestamp(value.plannedEndAt) &&
    nullableTimestamp(value.actualEndedAt) &&
    nullableTimestamp(value.lastCheckpointAt) &&
    nullableNumber(value.activeSeconds) &&
    nullableNumber(value.pauseSeconds) &&
    nullableNumber(value.elapsedActiveSeconds) &&
    nullableNumber(value.remainingSeconds) &&
    typeof value.completionEligible === "boolean" &&
    typeof value.sessionNumber === "number" &&
    Number.isSafeInteger(value.sessionNumber) &&
    value.sessionNumber >= 1 &&
    typeof value.plannedSessionCount === "number" &&
    Number.isSafeInteger(value.plannedSessionCount) &&
    value.plannedSessionCount >= 1 &&
    typeof value.isLastPlannedSession === "boolean" &&
    typeof value.reconciliationRequired === "boolean" &&
    (value.completionReason === null || typeof value.completionReason === "string");
}

function parseEntry(value: unknown): FocusRuntimeCacheEntry | null {
  if (!isRecord(value) ||
      value.version !== FOCUS_RUNTIME_CACHE_VERSION ||
      value.authority !== NON_AUTHORITATIVE ||
      !isValidServerTimestamp(value.serverNow) ||
      !isValidServerTimestamp(value.savedAt) ||
      !(value.session === null || isCachedSession(value.session))) {
    return null;
  }
  return value as unknown as FocusRuntimeCacheEntry;
}

/**
 * Account-scoped, disposable display cache. The record is explicitly
 * non-authoritative and must only be written from canonical API responses.
 */
export function createFocusRuntimeCache(
  accountId: string | null | undefined,
  storage?: FocusCacheStorage | null,
): FocusRuntimeCache {
  const safeAccountId = typeof accountId === "string" && accountId.trim()
    ? accountId.trim()
    : null;
  const key = safeAccountId
    ? accountStorageKey(FOCUS_RUNTIME_CACHE_KEY, safeAccountId)
    : null;
  let targetStorage: FocusCacheStorage | null = storage ?? null;
  if (storage === undefined) {
    try {
      targetStorage = typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      targetStorage = null;
    }
  }

  return {
    read() {
      if (!key || !targetStorage) return null;
      try {
        const raw = targetStorage.getItem(key);
        if (!raw) return null;
        const parsed = parseEntry(JSON.parse(raw));
        if (!parsed) targetStorage.removeItem(key);
        return parsed;
      } catch {
        try {
          targetStorage.removeItem(key);
        } catch {
          // Restricted storage is an unavailable optimization, not a failure.
        }
        return null;
      }
    },
    write(entry) {
      if (!key || !targetStorage) return;
      const validated = parseEntry(entry);
      if (!validated) return;
      try {
        targetStorage.setItem(key, JSON.stringify(validated));
      } catch {
        // Cache writes must never change canonical Focus behavior.
      }
    },
    clear() {
      if (!key || !targetStorage) return;
      try {
        targetStorage.removeItem(key);
      } catch {
        // Cache cleanup is best effort.
      }
    },
  };
}