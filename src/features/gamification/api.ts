import { apiClient } from "../../core/api/apiClient";
import type {
  AchievementsResponse,
  ChallengesResponse,
  GamificationSummary,
  LeaderboardResponse,
  LeaderboardScope,
  OwnRankResponse,
  PublicProfile,
} from "./types";

async function readJson<T>(path: string): Promise<T> {
  const response = await apiClient(path, {
    method: "GET",
    bypassCache: true,
    ttl: 0,
    cache: "no-store",
    silent: true,
  });
  return response.json() as Promise<T>;
}

export const gamificationApi = {
  summary: () => readJson<GamificationSummary>("/api/me/gamification"),
  achievements: () => readJson<AchievementsResponse>("/api/me/achievements"),
  challenges: () => readJson<ChallengesResponse>("/api/me/challenges"),
  leaderboard: (scope: LeaderboardScope, cursor?: string | null) => {
    const params = new URLSearchParams({ limit: "50" });
    if (cursor) params.set("cursor", cursor);
    return readJson<LeaderboardResponse>(`/api/leaderboards/${scope}?${params.toString()}`);
  },
  ownRank: (scope: LeaderboardScope, seasonKey?: string) => {
    const params = new URLSearchParams({ scope });
    if (seasonKey) params.set("seasonKey", seasonKey);
    return readJson<OwnRankResponse>(`/api/me/leaderboard-rank?${params.toString()}`);
  },
  publicProfile: (userId: string) =>
    readJson<PublicProfile>(`/api/users/${encodeURIComponent(userId)}/gamification`),
};