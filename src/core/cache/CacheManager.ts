/**
 * CacheManager — 99's Guide Offline & Cache Optimization
 *
 * TTL-aware, two-tier cache:
 *   Tier 1: In-memory Map  — instant reads, survives tab navigation
 *   Tier 2: IndexedDB      — survives page reload / app restart
 *
 * Pattern: stale-while-revalidate
 *   - Serve from memory or IDB immediately if within TTL
 *   - Always write fresh network data back to both tiers
 *   - Callers keep the network fetch; CacheManager only adds the
 *     instant-render layer on top
 *
 * Default TTLs (tuned for this app):
 *   materials / subjects   5 min
 *   lectures list          5 min
 *   calendar events        2 min
 *   notifications          1 min
 */

import { IDBManager } from "../utils/indexedDB";

interface MemoryEntry {
  data: unknown;
  cachedAt: number;
  ttl: number;
}

interface StoredEntry {
  data: unknown;
  cachedAt: number;
}

class CacheManagerClass {
  private memory = new Map<string, MemoryEntry>();

  // ── Tier 1: memory ──────────────────────────────────────────────────────────
  private memGet<T>(key: string, ttlMs: number): T | null {
    const entry = this.memory.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > ttlMs) {
      this.memory.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private memSet(key: string, data: unknown, ttlMs: number): void {
    this.memory.set(key, { data, cachedAt: Date.now(), ttl: ttlMs });
  }

  // ── Tier 2: IDB ─────────────────────────────────────────────────────────────
  private async idbGet<T>(key: string, ttlMs: number): Promise<T | null> {
    try {
      const stored = await IDBManager.getItem<StoredEntry>(
        `cache:${key}`,
      );
      if (!stored) return null;
      if (Date.now() - stored.cachedAt > ttlMs) return null;
      return stored.data as T;
    } catch {
      return null;
    }
  }

  private idbSet(key: string, data: unknown): void {
    IDBManager.setItem(`cache:${key}`, {
      data,
      cachedAt: Date.now(),
    } satisfies StoredEntry).catch(() => {});
  }

  private idbDelete(key: string): void {
    IDBManager.removeItem(`cache:${key}`).catch(() => {});
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Read from cache. Returns null if missing or expired.
   * Memory is checked first (synchronous); IDB is checked as fallback (async).
   */
  async get<T>(key: string, ttlMs: number): Promise<T | null> {
    // Fast path: memory
    const mem = this.memGet<T>(key, ttlMs);
    if (mem !== null) return mem;

    // Slow path: IDB (survives reload)
    const persisted = await this.idbGet<T>(key, ttlMs);
    if (persisted !== null) {
      // Repopulate memory for subsequent synchronous hits
      this.memSet(key, persisted, ttlMs);
      return persisted;
    }

    return null;
  }

  /**
   * Write to both tiers. IDB write is fire-and-forget.
   */
  async set(key: string, data: unknown, ttlMs: number): Promise<void> {
    this.memSet(key, data, ttlMs);
    this.idbSet(key, data);
  }

  /**
   * Remove entries whose keys contain `pattern`.
   * Pass no argument to clear everything (both memory and IDB tiers).
   */
  invalidate(pattern?: string): void {
    if (!pattern) {
      // Clear memory tier immediately
      this.memory.clear();
      // Clear IDB tier — enumerate all cache:* keys and delete them.
      // Fire-and-forget; errors are non-fatal (memory is already clear).
      IDBManager.getAllKeys()
        .then((keys: string[]) => {
          for (const k of keys) {
            if (k.startsWith("cache:")) {
              IDBManager.removeItem(k).catch(() => {});
            }
          }
        })
        .catch(() => {});
      return;
    }
    for (const k of this.memory.keys()) {
      if (k.includes(pattern)) {
        this.memory.delete(k);
        this.idbDelete(k);
      }
    }
  }

  /** Synchronous memory-only peek — useful for immediate UI without async overhead */
  peek<T>(key: string, ttlMs: number): T | null {
    return this.memGet<T>(key, ttlMs);
  }
}

export const CacheManager = new CacheManagerClass();

// ── Named TTLs for consistent usage across the app ─────────────────────────────
export const CACHE_TTL = {
  MATERIALS: 5 * 60_000,   // 5 min  — subjects + seed content
  LECTURES:  5 * 60_000,   // 5 min  — lecture list
  CALENDAR:  2 * 60_000,   // 2 min  — calendar events
  NOTIFS:    1 * 60_000,   // 1 min  — notifications
  USERS:     3 * 60_000,   // 3 min  — user roster
} as const;
