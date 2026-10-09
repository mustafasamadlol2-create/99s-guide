import { apiClient } from "../../core/api/apiClient";
import {
  readGamificationResource,
  type GamificationSyncResource,
} from "./realtime";
import type {
  AchievementsResponse,
  ChallengesResponse,
  GamificationSummary,
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
  leaderboard: (scope: LeaderboardScope, cursor?: string | null) => {
    const params = new URLSearchParams({ limit: "50" });
    if (cursor) params.set("cursor", cursor);
    return readJson<LeaderboardResponse>(
      "leaderboard",
      `${scope}:${cursor ?? "first"}`,
      `/api/leaderboards/${scope}?${params.toString()}`,
    );
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