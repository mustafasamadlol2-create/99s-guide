import { randomUUID } from "node:crypto";

export const GAMIFICATION_UPDATE_EVENT = "gamification_updated";

export const GAMIFICATION_UPDATE_RESOURCES = [
  "summary",
  "achievements",
  "challenges",
  "leaderboard",
  "rank",
] as const;

export type GamificationUpdateResource =
  (typeof GAMIFICATION_UPDATE_RESOURCES)[number];

export interface GamificationUpdatePayload {
  eventId: string;
  changedAt: string;
  resources: GamificationUpdateResource[];
}

export function createGamificationUpdateBroadcaster(
  emitToUser: (userId: string, payload: GamificationUpdatePayload) => void,
  emitToAuthenticated: (payload: GamificationUpdatePayload) => void,
): (
  userId: string,
  resources: readonly GamificationUpdateResource[],
) => void {
  return (userId, resources) => {
    const uniqueResources = [...new Set(resources)];
    if (!userId || uniqueResources.length === 0) return;
    const changedAt = new Date().toISOString();
    const payload: GamificationUpdatePayload = {
      eventId: randomUUID(),
      changedAt,
      resources: uniqueResources,
    };
    try {
      emitToUser(userId, payload);
    } catch {
      console.warn("[Gamification] User update broadcast failed.");
    }

    if (uniqueResources.includes("leaderboard")) {
      try {
        emitToAuthenticated({
          eventId: randomUUID(),
          changedAt,
          resources: ["leaderboard", "rank"],
        });
      } catch {
        console.warn("[Gamification] Leaderboard update broadcast failed.");
      }
    }
  };
}
