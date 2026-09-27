import express from "express";
import { isStudyFeatureEnabled } from "../features/study-core/featureFlags.js";
import { readStudyAnalyzer } from "../features/study-analyzer/service.js";
import type { StudyAnalyzerDto } from "../features/study-analyzer/types.js";

type AuthenticatedRequest = express.Request & {
  user?: { id?: string };
};

export function createStudyAnalyzerRouter(dependencies: {
  requireUser: express.RequestHandler;
  readAnalyzer?: (userId: string) => Promise<StudyAnalyzerDto>;
  isEnabled?: () => boolean;
}): express.Router {
  const router = express.Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Vary", "Authorization, Cookie");
    next();
  });
  router.use(dependencies.requireUser);

  router.get("/", async (req, res) => {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required." });
    const enabled = dependencies.isEnabled
      ? dependencies.isEnabled()
      : isStudyFeatureEnabled("STUDY_ANALYZER_ENABLED");
    if (!enabled) {
      return res.status(404).json({ error: "Study Analyzer is not available." });
    }
    if (Object.keys(req.query).length > 0 || hasRequestBody(req.body)) {
      return res.status(400).json({ error: "Study Analyzer does not accept request parameters." });
    }
    try {
      return res.json(await (dependencies.readAnalyzer ?? readStudyAnalyzer)(userId));
    } catch {
      return res.status(503).json({ error: "Unable to load the private Study Analyzer." });
    }
  });

  return router;
}

function hasRequestBody(body: unknown): boolean {
  if (body === undefined || body === null) return false;
  if (typeof body === "object" && !Array.isArray(body)) {
    return Object.keys(body).length > 0;
  }
  return true;
}