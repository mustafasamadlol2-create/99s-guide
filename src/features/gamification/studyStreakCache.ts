import { gamificationApi } from "./api";

export const STUDY_STREAK_CACHE_EVENT = "study-streak-cache-updated";
const STUDY_STREAK_CACHE_PREFIX = "study-streak:v1:";

export interface StudyStreakCacheEntry {
  accountId: string;
  currentStreakDays: number;
  updatedAt: number;
}

function normalizeDays(value: unknown): number | null {
  const days = Number(value);
  return Number.isFinite(days) && days >= 0 ? Math.trunc(days) : null;
}

export function readStudyStreakCache(accountId: string): StudyStreakCacheEntry | null {
  if (typeof window === "undefined" || !accountId) return null;
  try {
    const raw = window.localStorage.getItem(`${STUDY_STREAK_CACHE_PREFIX}${accountId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StudyStreakCacheEntry>;
    const currentStreakDays = normalizeDays(parsed.currentStreakDays);
    if (currentStreakDays === null) return null;
    return {
      accountId,
      currentStreakDays,
      updatedAt: Number.isFinite(Number(parsed.updatedAt)) ? Number(parsed.updatedAt) : 0,
    };
  } catch {
    return null;
  }
}

export function writeStudyStreakCache(accountId: string, currentStreakDays: number): StudyStreakCacheEntry {
  const entry: StudyStreakCacheEntry = {
    accountId,
    currentStreakDays: Math.max(0, Math.trunc(currentStreakDays)),
    updatedAt: Date.now(),
  };

  if (typeof window !== "undefined" && accountId) {
    try {
      window.localStorage.setItem(
        `${STUDY_STREAK_CACHE_PREFIX}${accountId}`,
        JSON.stringify(entry),
      );
    } catch {
      // Local storage can be unavailable in restricted/private webviews.
    }

    window.dispatchEvent(new CustomEvent<StudyStreakCacheEntry>(STUDY_STREAK_CACHE_EVENT, {
      detail: entry,
    }));
  }

  return entry;
}

/**
 * Warms the current user's streak before Profile is opened. The server remains
 * canonical; the local value is only a last-known render cache used to avoid a
 * delayed badge appearing after the Profile screen is already visible.
 */
export async function warmStudyStreakCache(accountId: string): Promise<StudyStreakCacheEntry | null> {
  if (!accountId) return null;
  try {
    const result = await gamificationApi.studyStreak();
    return writeStudyStreakCache(accountId, result.currentStreakDays);
  } catch {
    return readStudyStreakCache(accountId);
  }
}
