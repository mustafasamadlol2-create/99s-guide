import express, { type RequestHandler } from "express";
import { GamificationError } from "../features/gamification/errors.js";
import type { MyChallengesResponse } from "../features/gamification/challengeTypes.js";

type AuthenticatedRequest = express.Request & { user: { id: string } };

export interface ChallengesRouteDependencies {
  requireUser: RequestHandler;
  getMyChallenges(userId: string): Promise<MyChallengesResponse>;
}

export function createChallengesRouter(
  dependencies: ChallengesRouteDependencies,
): express.Router {
  const router = express.Router();
  router.use(dependencies.requireUser);
  router.get("/", async (req, res) => {
    const userId = (req as AuthenticatedRequest).user.id;
    try {
      const result = await dependencies.getMyChallenges(userId);
      return res
        .set("Cache-Control", "no-store, private")
        .json(result);
    } catch (error) {
      const code = error instanceof GamificationError
        ? error.code
        : "GAMIFICATION_CHALLENGE_READ_FAILED";
      return res
        .set("Cache-Control", "no-store, private")
        .status(503)
        .json({
          error: "Challenges are temporarily unavailable.",
          code,
        });
    }
  });
  return router;
}