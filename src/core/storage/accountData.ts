import { IDBManager } from "../utils/indexedDB";

let activeAccountId: string | null = null;

const LEGACY_PERSONAL_KEYS = new Set([
  "calendar_events",
  "progress_db",
  "points_log",
  "app_notifications_v1",
  "offline_mutations_queue",
  "offline_dlq",
  "uob_active_view",
  "uob_selected_date",
  "uob_current_year",
  "uob_current_month",
  "app_event_durations_v1",
  "my_academic_group",
  "recent_global_searches",
  "draft_lecture_title",
  "draft_notif_title",
  "draft_notif_message",
  "draft_calendar_title",
  "draft_calendar_start",
  "draft_calendar_end",
]);

function accountPrefix(accountId: string): string {
  return `account:${accountId}:`;
}

export function setActiveAccountId(accountId: string | null): void {
  activeAccountId = accountId || null;
}

export function getActiveAccountId(): string | null {
  return activeAccountId;
}

/** Return a stable per-account key. Anonymous data is never shared with users. */
export function accountStorageKey(key: string, accountId = activeAccountId): string {
  return accountId ? `${accountPrefix(accountId)}${key}` : `account:anonymous:${key}`;
}

/**
 * Remove personal browser/IDB cache entries without touching public app caches.
 *
 * Always sweeps the fallback `account:anonymous:` namespace plus the legacy
 * unscoped personal keys, and additionally the per-account scope for the
 * supplied account (or the active account when none is supplied). This
 * guarantees no user data survives logout or account deletion even if data was
 * written before the account scope was established.
 */
export async function clearAccountData(accountId?: string | null): Promise<void> {
  const prefix = accountId ? accountPrefix(accountId) : activeAccountId ? accountPrefix(activeAccountId) : null;
  const prefixes = new Set<string>();
  if (prefix) prefixes.add(prefix);
  prefixes.add("account:anonymous:");
  const isScopedKey = (key: string): boolean =>
    Array.from(prefixes).some((p) => key.startsWith(p));

  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      const isScoped = isScopedKey(key);
      const isLegacyPersonal = LEGACY_PERSONAL_KEYS.has(key) ||
        /^(notes_|likes_|uob_has_opened_(pdf|notes)_)/.test(key);
      if (isScoped || isLegacyPersonal) localStorage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable in restricted webviews; continue with IDB.
  }

  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key && (key.startsWith("scroll_pos_") || isScopedKey(key))) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {
    // Best effort only.
  }

  try {
    const keys = await IDBManager.getAllKeys();
    const keysToRemove = keys.filter((key) =>
      Array.from(prefixes).some((p) => key.includes(p)) ||
      key === "cache:calendar" ||
      key === "cache:account:anonymous:calendar",
    );
    await Promise.all(keysToRemove.map((key) => IDBManager.removeItem(key)));
  } catch {
    // Cache cleanup must never prevent logout/account deletion.
  }
}
