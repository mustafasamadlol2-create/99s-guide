import express, { type RequestHandler } from "express";
import {
  GamificationError,
} from "../features/gamification/errors.js";
import type {
  MyAchievementUnlockView,
  MyAchievementView,
} from "../features/gamification/achievementService.js";

type AuthenticatedRequest = express.Request & { user: { id: string } };

export interface AchievementRouteDependencies {
  requireUser: RequestHandler;
  getMyAchievements(userId: string): Promise<{
    ruleSetVersion: string;
    achievements: MyAchievementView[];
    unlockHistory: MyAchievementUnlockView[];
  }>;
}

export function createAchievementsRouter(
  dependencies: AchievementRouteDependencies,
): express.Router {
  const router = express.Router();
  router.use(dependencies.requireUser);
  router.get("/", async (req, res) => {
    const userId = (req as AuthenticatedRequest).user.id;
    try {
      const result = await dependencies.getMyAchievements(userId);
      return res
        .set("Cache-Control", "no-store, private")
        .json(result);
    } catch (error) {
      const code = error instanceof GamificationError
        ? error.code
        : "GAMIFICATION_READ_FAILED";
      return res
        .set("Cache-Control", "no-store, private")
        .status(503)
        .json({
          error: "Achievements are temporarily unavailable.",
          code,
        });
    }
  });
  return router;
}