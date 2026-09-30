import express, { type RequestHandler } from "express";
import { GamificationError } from "../features/gamification/errors.js";
import type { MyGamificationSummary } from "../features/gamification/levelTypes.js";
import type { PublicGamificationProfile } from "../features/gamification/levelTypes.js";

type AuthenticatedRequest = express.Request & { user: { id: string } };

export interface GamificationRouteDependencies {
  requireUser: RequestHandler;
  getMyGamificationSummary(userId: string): Promise<MyGamificationSummary>;
  getPublicGamificationProfile(
    viewerId: string,
    profileUserId: string,
  ): Promise<PublicGamificationProfile | null>;
}

function errorCode(error: unknown): string {
  return error instanceof GamificationError
    ? error.code
    : "GAMIFICATION_READ_FAILED";
}

export function createGamificationRouter(
  dependencies: GamificationRouteDependencies,
): express.Router {
  const router = express.Router();

  // This router is mounted at /api, so a router-wide auth middleware would
  // intercept unrelated public endpoints such as /api/auth/oauth-url. Keep
  // authentication scoped to the routes owned by this router.
  router.get("/me/gamification", dependencies.requireUser, async (req, res) => {
    const userId = (req as AuthenticatedRequest).user.id;
    try {
      const result = await dependencies.getMyGamificationSummary(userId);
      return res
        .set("Cache-Control", "no-store, private")
        .json(result);
    } catch (error) {
      return res
        .set("Cache-Control", "no-store, private")
        .status(503)
        .json({
          error: "Gamification is temporarily unavailable.",
          code: errorCode(error),
        });
    }
  });

  router.get("/users/:userId/gamification", dependencies.requireUser, async (req, res) => {
    const viewerId = (req as unknown as AuthenticatedRequest).user.id;
    try {
      const result = await dependencies.getPublicGamificationProfile(
        viewerId,
        req.params.userId,
      );
      res.set("Cache-Control", "no-store, private");
      if (!result) {
        return res.status(404).json({ error: "Profile not found." });
      }
      return res.json(result);
    } catch (error) {
      return res
        .set("Cache-Control", "no-store, private")
        .status(503)
        .json({
          error: "Gamification is temporarily unavailable.",
          code: errorCode(error),
        });
    }
  });
  return router;
}