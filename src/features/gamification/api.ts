import { apiClient } from "../../core/api/apiClient";
import {
  readGamificationResource,
  type GamificationSyncResource,
} from "./realtime";
import type {
  AchievementsResponse,
  ChallengesResponse,
  GamificationSummary,
  LeaderboardAvailabilityResponse,
  LeaderboardResponse,
  LeaderboardScope,
  OwnRankResponse,
  PublicProfile,
} from "./types";

async function readJson<T>(
  resource: GamificationSyncResource,
  variant: string,
  path: string,
): Promise<T> {
  return readGamificationResource(resource, variant, async (requestKey) => {
    const response = await apiClient(path, {
      method: "GET",
      bypassCache: true,
      ttl: 0,
      cache: "no-store",
      silent: true,
      requestKey,
      // Leaderboard D1 reads now fail over quickly, but the canonical
      // PostgreSQL fallback must be allowed to finish during transient pool
      // contention instead of being aborted and rendered as an empty result.
      timeoutMs: 12_000,
      retries: 0,
    });
    return response.json() as Promise<T>;
  });
}

export const gamificationApi = {
  summary: () =>
    readJson<GamificationSummary>("summary", "current", "/api/me/gamification"),
  achievements: () =>
    readJson<AchievementsResponse>("achievements", "current", "/api/me/achievements"),
  challenges: () =>
    readJson<ChallengesResponse>("challenges", "current", "/api/me/challenges"),
  leaderboard: (scope: LeaderboardScope, cursor?: string | null, limit = 100) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return readJson<LeaderboardResponse>(
      "leaderboard",
      `${scope}:${limit}:${cursor ?? "first"}`,
      `/api/leaderboards/${scope}?${params.toString()}`,
    );
  },
  leaderboardAvailability: async () => {
    const response = await apiClient("/api/leaderboards/availability", {
      method: "GET",
      bypassCache: true,
      ttl: 0,
      cache: "no-store",
      silent: true,
      timeoutMs: 5_000,
      retries: 0,
    });
    return response.json() as Promise<LeaderboardAvailabilityResponse>;
  },
  ownRank: (scope: LeaderboardScope, seasonKey?: string) => {
    const params = new URLSearchParams({ scope });
    if (seasonKey) params.set("seasonKey", seasonKey);
    return readJson<OwnRankResponse>(
      "rank",
      `${scope}:${seasonKey ?? "current"}`,
      `/api/me/leaderboard-rank?${params.toString()}`,
    );
  },
  publicProfile: (userId: string) =>
    readJson<PublicProfile>(
      "profile",
      userId,
      `/api/users/${encodeURIComponent(userId)}/gamification`,
    ),
};