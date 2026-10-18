export const GAMIFICATION_INVALIDATED_EVENT = "gamification-state-invalidated";
export const GAMIFICATION_SOCKET_RECONNECTED_EVENT = "gamification-socket-reconnected";
export const GAMIFICATION_UPDATE_EVENT = "gamification_updated";
export const GAMIFICATION_OPTIMISTIC_POINTS_EVENT = "gamification-optimistic-points";

export const GAMIFICATION_SYNC_RESOURCES = [
  "summary",
  "achievements",
  "challenges",
  "leaderboard",
  "rank",
  "profile",
] as const;

export type GamificationSyncResource =
  (typeof GAMIFICATION_SYNC_RESOURCES)[number];

export interface GamificationInvalidationDetail {
  eventId?: string;
  changedAt?: string;
  resources: GamificationSyncResource[];
}

type GamificationReadLoader<T> = (requestKey: string) => Promise<T>;

const readEpochs = new Map<string, number>();
const readFlights = new Map<string, Promise<unknown>>();
const readResults = new Map<string, { expiresAt: number; value: unknown }>();
const seenEventIds = new Set<string>();
let accountScope = "anonymous";

type OptimisticStudyPointsEntry = {
  delta: number;
  committed: boolean;
  createdAt: number;
};

const optimisticStudyPoints = new Map<string, OptimisticStudyPointsEntry>();
const OPTIMISTIC_STUDY_POINTS_TTL_MS = 30_000;

function emitOptimisticStudyPointsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(GAMIFICATION_OPTIMISTIC_POINTS_EVENT));
}

function pruneOptimisticStudyPoints(now = Date.now()): void {
  for (const [key, entry] of optimisticStudyPoints) {
    if (now - entry.createdAt > OPTIMISTIC_STUDY_POINTS_TTL_MS) {
      optimisticStudyPoints.delete(key);
    }
  }
}

export function beginOptimisticStudyPoints(token: string, delta: number): void {
  if (!token || !Number.isFinite(delta) || delta <= 0) return;
  pruneOptimisticStudyPoints();
  if (!optimisticStudyPoints.has(token)) {
    optimisticStudyPoints.set(token, { delta, committed: false, createdAt: Date.now() });
    emitOptimisticStudyPointsChanged();
  }
}

export function settleOptimisticStudyPoints(token: string, awarded: number): void {
  if (!token) return;
  pruneOptimisticStudyPoints();
  if (!Number.isFinite(awarded) || awarded <= 0) {
    if (optimisticStudyPoints.delete(token)) emitOptimisticStudyPointsChanged();
    return;
  }
  optimisticStudyPoints.set(token, {
    delta: awarded,
    committed: true,
    createdAt: Date.now(),
  });
  emitOptimisticStudyPointsChanged();
}

export function rollbackOptimisticStudyPoints(token: string): void {
  if (!token) return;
  if (optimisticStudyPoints.delete(token)) emitOptimisticStudyPointsChanged();
}

export function acknowledgeCommittedOptimisticStudyPoints(): void {
  let changed = false;
  for (const [key, entry] of optimisticStudyPoints) {
    if (!entry.committed) continue;
    optimisticStudyPoints.delete(key);
    changed = true;
  }
  if (changed) emitOptimisticStudyPointsChanged();
}

export function getOptimisticStudyPointsDelta(): number {
  pruneOptimisticStudyPoints();
  let total = 0;
  for (const entry of optimisticStudyPoints.values()) total += entry.delta;
  return total;
}

function readEpoch(scope: string): number {
  return readEpochs.get(scope) ?? 0;
}

export function setGamificationReadAccountScope(
  accountId: string | null | undefined,
): void {
  accountScope = typeof accountId === "string" && accountId.trim()
    ? accountId.trim()
    : "anonymous";
}

export function invalidateGamificationResources(
  resources: readonly GamificationSyncResource[],
): void {
  for (const resource of new Set(resources)) {
    const scope = `${accountScope}|${resource}`;
    readEpochs.set(scope, readEpoch(scope) + 1);
  }
}

/**
 * Shares matching reads. A response that crosses an invalidation is discarded
 * and retried at the latest epoch before it can reach the UI.
 */
export async function readGamificationResource<T>(
  resource: GamificationSyncResource,
  variant: string,
  load: GamificationReadLoader<T>,
  options: { cacheTtlMs?: number } = {},
): Promise<T> {
  const scope = `${accountScope}|${resource}`;
  for (;;) {
    const epoch = readEpoch(scope);
    const flightKey = `${scope}|${variant}|${epoch}`;
    const cached = readResults.get(flightKey);
    if (cached) {
      if (cached.expiresAt > Date.now()) return cached.value as T;
      readResults.delete(flightKey);
    }
    let flight = readFlights.get(flightKey) as Promise<T> | undefined;
    if (!flight) {
      const requestKey = `${flightKey}`;
      const pending = Promise.resolve().then(() => load(requestKey));
      const tracked = pending.finally(() => {
        if (readFlights.get(flightKey) === tracked) {
          readFlights.delete(flightKey);
        }
      });
      readFlights.set(flightKey, tracked);
      flight = tracked;
    }

    let result: T;
    try {
      result = await flight;
    } catch (error) {
      if (readEpoch(scope) !== epoch) continue;
      throw error;
    }
    if (readEpoch(scope) === epoch) {
      const cacheTtlMs = Math.max(0, options.cacheTtlMs ?? 0);
      if (cacheTtlMs > 0) {
        readResults.set(flightKey, { expiresAt: Date.now() + cacheTtlMs, value: result });
        while (readResults.size > 128) {
          const oldestKey = readResults.keys().next().value;
          if (oldestKey === undefined) break;
          readResults.delete(oldestKey);
        }
      }
      return result;
    }
  }
}

export function acceptGamificationUpdate(
  value: unknown,
): GamificationInvalidationDetail | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.resources)) return null;
  const resources = [...new Set(input.resources.filter(
    (resource): resource is GamificationSyncResource =>
      typeof resource === "string" &&
      (GAMIFICATION_SYNC_RESOURCES as readonly string[]).includes(resource),
  ))];
  if (resources.length === 0) return null;

  const eventId = typeof input.eventId === "string" &&
      input.eventId.length > 0 && input.eventId.length <= 128
    ? input.eventId
    : undefined;
  if (eventId && seenEventIds.has(eventId)) return null;
  if (eventId) {
    seenEventIds.add(eventId);
    if (seenEventIds.size > 500) {
      const oldest = seenEventIds.values().next().value;
      if (oldest) seenEventIds.delete(oldest);
    }
  }

  const detail: GamificationInvalidationDetail = {
    resources,
    ...(eventId ? { eventId } : {}),
    ...(typeof input.changedAt === "string"
      ? { changedAt: input.changedAt }
      : {}),
  };
  invalidateGamificationResources(resources);
  return detail;
}

export function resourcesForGamificationReconnect(
  tab: "overview" | "achievements" | "challenges" | "leaderboard",
  cached: { leaderboard: boolean; rank: boolean } = { leaderboard: false, rank: false },
): GamificationSyncResource[] {
  const resources: GamificationSyncResource[] = [
    "summary",
    "achievements",
    "challenges",
  ];
  if (tab === "overview" || cached.rank) resources.push("rank");
  if (tab === "leaderboard" || cached.leaderboard) {
    resources.push("leaderboard", "rank");
  }
  return resources;
}
