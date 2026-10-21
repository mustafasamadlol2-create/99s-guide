import express, { type RequestHandler } from "express";
import { studyStreakService, type StudyStreakSummary } from "../features/study-streak/service.js";

type AuthenticatedRequest = express.Request & { user: { id: string } };

export interface StudyStreakRouteDependencies {
  requireUser: RequestHandler;
  getSummary?: (userId: string) => Promise<StudyStreakSummary>;
}

export function createStudyStreakRouter(dependencies: StudyStreakRouteDependencies): express.Router {
  const router = express.Router();
  const getSummary = dependencies.getSummary ?? studyStreakService.getSummary;

  router.get("/me/study-streak", dependencies.requireUser, async (req, res) => {
    const userId = (req as AuthenticatedRequest).user.id;
    try {
      const result = await getSummary(userId);
      return res.set("Cache-Control", "no-store, private, max-age=0").json(result);
    } catch (error) {
      console.warn("[StudyStreak] Failed to build streak summary.", {
        userId,
        reason: error instanceof Error ? error.message : "unknown",
      });
      return res
        .set("Cache-Control", "no-store, private, max-age=0")
        .status(503)
        .json({ error: "Study streak is temporarily unavailable.", code: "STUDY_STREAK_UNAVAILABLE" });
    }
  });

  return router;
}
