import express, { type RequestHandler } from "express";
import { todayStudyService, type TodayStudySummary } from "../features/today-study/service.js";

type AuthenticatedRequest = express.Request & { user: { id: string } };

export interface TodayStudyRouteDependencies {
  requireUser: RequestHandler;
  getSummary?: (userId: string) => Promise<TodayStudySummary>;
}

export function createTodayStudyRouter(dependencies: TodayStudyRouteDependencies): express.Router {
  const router = express.Router();
  const getSummary = dependencies.getSummary ?? todayStudyService.getSummary;

  router.get("/me/today-study", dependencies.requireUser, async (req, res) => {
    const userId = (req as AuthenticatedRequest).user.id;
    try {
      const summary = await getSummary(userId);
      return res
        .set("Cache-Control", "no-store, private, max-age=0, must-revalidate")
        .json(summary);
    } catch (error) {
      console.warn("[TodayStudy] Failed to build Today card summary.", {
        userId,
        reason: error instanceof Error ? error.message : "unknown",
      });
      return res
        .set("Cache-Control", "no-store, private, max-age=0")
        .status(503)
        .json({ error: "Today's study summary is temporarily unavailable.", code: "TODAY_STUDY_UNAVAILABLE" });
    }
  });

  return router;
}
