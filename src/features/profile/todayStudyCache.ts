import { apiClient } from "../../core/api/apiClient";

export const TODAY_STUDY_CACHE_EVENT = "today-study-cache-updated";
const TODAY_STUDY_CACHE_PREFIX = "today-study:v1:";
const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;

export type TodayStudySummary = {
  timeZone: "Asia/Baghdad";
  date: string;
  resetAt: string;
  focusSeconds: number;
  lecturesCompleted: number;
  mcqAttempts: number;
  flashcardReviews: number;
  videosCompleted: number;
  pointsEarned: number;
  updatedAt: string;
  sourceVersion: "today-study-v1";
};

export type TodayStudyCacheEntry = {
  accountId: string;
  summary: TodayStudySummary;
  cachedAt: number;
};

function currentBaghdadDateKey(now = new Date()): string {
  const shifted = new Date(now.getTime() + BAGHDAD_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

function isValidSummary(value: unknown): value is TodayStudySummary {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<TodayStudySummary>;
  return row.timeZone === "Asia/Baghdad"
    && typeof row.date === "string"
    && typeof row.resetAt === "string"
    && Number.isFinite(Number(row.focusSeconds))
    && Number.isFinite(Number(row.lecturesCompleted))
    && Number.isFinite(Number(row.mcqAttempts))
    && Number.isFinite(Number(row.flashcardReviews))
    && Number.isFinite(Number(row.videosCompleted))
    && Number.isFinite(Number(row.pointsEarned));
}

export function readTodayStudyCache(accountId: string): TodayStudyCacheEntry | null {
  if (typeof window === "undefined" || !accountId) return null;
  try {
    const raw = window.localStorage.getItem(`${TODAY_STUDY_CACHE_PREFIX}${accountId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TodayStudyCacheEntry>;
    if (parsed.accountId !== accountId || !isValidSummary(parsed.summary)) return null;
    // Never paint yesterday's values after the Baghdad midnight reset.
    if (parsed.summary.date !== currentBaghdadDateKey()) return null;
    return {
      accountId,
      summary: parsed.summary,
      cachedAt: Number.isFinite(Number(parsed.cachedAt)) ? Number(parsed.cachedAt) : 0,
    };
  } catch {
    return null;
  }
}

export function writeTodayStudyCache(accountId: string, summary: TodayStudySummary): TodayStudyCacheEntry {
  const entry: TodayStudyCacheEntry = { accountId, summary, cachedAt: Date.now() };
  if (typeof window !== "undefined" && accountId) {
    try {
      window.localStorage.setItem(`${TODAY_STUDY_CACHE_PREFIX}${accountId}`, JSON.stringify(entry));
    } catch {
      // Private/restricted webviews can reject localStorage. The live event still works.
    }
    window.dispatchEvent(new CustomEvent<TodayStudyCacheEntry>(TODAY_STUDY_CACHE_EVENT, { detail: entry }));
  }
  return entry;
}

export async function warmTodayStudyCache(accountId: string): Promise<TodayStudyCacheEntry | null> {
  if (!accountId) return null;
  try {
    const response = await apiClient("/api/me/today-study", {
      method: "GET",
      bypassCache: true,
      ttl: 0,
      cache: "no-store",
      silent: true,
      timeoutMs: 10_000,
      retries: 0,
      requestKey: `today-study:${accountId}`,
    });
    const summary = await response.json() as TodayStudySummary;
    if (!isValidSummary(summary)) throw new Error("Invalid Today study payload");
    return writeTodayStudyCache(accountId, summary);
  } catch {
    return readTodayStudyCache(accountId);
  }
}

export function millisecondsUntilNextBaghdadMidnight(now = new Date()): number {
  const shifted = new Date(now.getTime() + BAGHDAD_OFFSET_MS);
  const nextShiftedMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
    0, 0, 0, 0,
  );
  const nextInstant = nextShiftedMidnight - BAGHDAD_OFFSET_MS;
  return Math.max(1_000, nextInstant - now.getTime());
}
