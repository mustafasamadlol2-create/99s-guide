import express, { type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import {
  ASK_STUDY_DATA_MAX_QUESTION_CHARACTERS,
  askStudyDataRequestSchema,
} from "../../shared/askStudyData.js";
import { isStudyFeatureEnabled } from "../features/study-core/featureFlags.js";
import { askMyStudyData } from "../features/ask-study-data/service.js";
import type { AskMyStudyDataResponse } from "../features/ask-study-data/types.js";
import { isAskStudyDataLocale } from "../features/ask-study-data/workerClient.js";

type AuthenticatedRequest = express.Request & {
  user?: {
    id?: string;
    role?: string;
    preferences?: unknown;
  };
};

type AskStudyData = (input: {
  userId: string;
  question: string;
  locale: "ar" | "en";
}) => Promise<AskMyStudyDataResponse>;

function createRateLimiter(): RequestHandler {
  return rateLimit({
    windowMs: 60 * 60 * 1_000,
    limit: 20,
    keyGenerator: (req) => {
      const userId = (req as AuthenticatedRequest).user?.id;
      return typeof userId === "string" && userId.length > 0
        ? `ask-study-data:${userId}`
        : "ask-study-data:missing-user";
    },
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({
      error: "Ask My Study Data request limit exceeded.",
      code: "ASK_STUDY_DATA_RATE_LIMITED",
    }),
  });
}

export function createAskStudyDataRouter(dependencies: {
  requireUser: RequestHandler;
  ask?: AskStudyData;
  isEnabled?: () => boolean;
  rateLimiter?: RequestHandler;
}): express.Router {
  const router = express.Router();
  const rateLimiter = dependencies.rateLimiter ?? createRateLimiter();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "Authorization, Cookie");
    next();
  });
  router.use(dependencies.requireUser);
  router.post("/", (req, res, next) => {
    const user = (req as AuthenticatedRequest).user;
    if (user?.role === "admin" || user?.role === "owner") {
      return res.status(403).json({
        error: "Ask My Study Data is available only to student accounts.",
        code: "STUDENT_ACCESS_ONLY",
      });
    }
    const enabled = dependencies.isEnabled
      ? dependencies.isEnabled()
      : isStudyFeatureEnabled("ASK_MY_STUDY_DATA_ENABLED");
    if (!enabled) {
      return res.status(404).json({
        error: "Ask My Study Data is not available.",
        code: "FEATURE_DISABLED",
      });
    }
    return rateLimiter(req, res, next);
  }, async (req, res) => {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required." });

    const parsed = askStudyDataRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Request must contain only question and optional locale.",
        code: "INVALID_ASK_STUDY_DATA_REQUEST",
      });
    }
    const question = parsed.data.question.trim();
    if (Array.from(question).length < 2 ||
        Array.from(question).length > ASK_STUDY_DATA_MAX_QUESTION_CHARACTERS) {
      return res.status(400).json({
        error: "Question must contain between 2 and 500 Unicode characters.",
        code: "INVALID_ASK_STUDY_DATA_QUESTION",
      });
    }
    const preferences = (req as AuthenticatedRequest).user?.preferences;
    const preferredLocale = typeof preferences === "object" && preferences !== null &&
        "language" in preferences
      ? (preferences as { language?: unknown }).language
      : undefined;
    const locale = parsed.data.locale ??
      (isAskStudyDataLocale(preferredLocale) ? preferredLocale : "en");

    try {
      const result = await (dependencies.ask ?? askMyStudyData)({
        userId,
        question,
        locale,
      });
      return res.json(result);
    } catch {
      return res.status(503).json({
        error: "Unable to read private study facts.",
        code: "ASK_STUDY_DATA_UNAVAILABLE",
      });
    }
  });
  router.all("/", (_req, res) => res.status(405).json({
    error: "Method not allowed.",
    code: "METHOD_NOT_ALLOWED",
  }));
  return router;
}