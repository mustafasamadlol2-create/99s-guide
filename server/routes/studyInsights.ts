import express, { type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { isStudyFeatureEnabled } from "../features/study-core/featureFlags.js";
import { getStudyInsight } from "../features/study-insights/service.js";
import { isStudyInsightLocale } from "../features/study-insights/workerClient.js";
import type { StudyInsightLocale, StudyInsightResponse } from "../features/study-insights/types.js";

type AuthenticatedRequest = express.Request & {
  user?: { id?: string };
};

type GenerateInsight = (input: {
  userId: string;
  locale: StudyInsightLocale;
}) => Promise<StudyInsightResponse>;

function hasRequestBody(body: unknown): boolean {
  if (body === undefined || body === null) return false;
  if (typeof body === "object" && !Array.isArray(body)) return Object.keys(body).length > 0;
  return true;
}

function createStudyInsightRateLimiter(): RequestHandler {
  return rateLimit({
    windowMs: 60 * 60 * 1_000,
    limit: 10,
    keyGenerator: (req) => {
      const userId = (req as AuthenticatedRequest).user?.id;
      return typeof userId === "string" && userId.length > 0
        ? `study-insight:${userId}`
        : "study-insight:missing-user";
    },
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({
      error: "Study Insight request limit exceeded.",
      code: "STUDY_INSIGHT_RATE_LIMITED",
    }),
  });
}

export function createStudyInsightsRouter(dependencies: {
  requireUser: RequestHandler;
  generate?: GenerateInsight;
  isEnabled?: () => boolean;
  rateLimiter?: RequestHandler;
}): express.Router {
  const router = express.Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "Authorization, Cookie");
    next();
  });
  router.use(dependencies.requireUser);
  router.use(dependencies.rateLimiter ?? createStudyInsightRateLimiter());

  router.get("/", async (req, res) => {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required." });
    const enabled = dependencies.isEnabled
      ? dependencies.isEnabled()
      : isStudyFeatureEnabled("AI_STUDY_INSIGHTS_ENABLED");
    if (!enabled) {
      return res.status(404).json({
        error: "AI Study Insights are not available.",
        code: "FEATURE_DISABLED",
      });
    }
    if (hasRequestBody(req.body)) {
      return res.status(400).json({ error: "Study Insights do not accept a request body." });
    }
    const queryKeys = Object.keys(req.query);
    if (queryKeys.some((key) => key !== "locale")) {
      return res.status(400).json({
        error: "Only the locale parameter is supported.",
        code: "INVALID_STUDY_INSIGHT_PARAMETERS",
      });
    }
    const rawLocale = req.query.locale === undefined ? "en" : req.query.locale;
    if (!isStudyInsightLocale(rawLocale)) {
      return res.status(400).json({
        error: "Locale must be ar or en.",
        code: "INVALID_STUDY_INSIGHT_LOCALE",
      });
    }

    try {
      const result = await (dependencies.generate ?? getStudyInsight)({
        userId,
        locale: rawLocale,
      });
      return res.json(result);
    } catch {
      return res.status(503).json({
        error: "Unable to load deterministic Study Analyzer facts.",
        code: "STUDY_ANALYZER_UNAVAILABLE",
      });
    }
  });

  return router;
}