import express from "express";
import {
  getMyLectureMasteryWithRetention,
} from "../features/mastery/privateRead.js";
import {
  readMasteryDashboard,
  readMasteryLectures,
  readMasteryReviews,
  readMasteryLectureDetail,
} from "../features/mastery/privateDashboard.js";
import { MASTERY_STATES } from "../features/study-core/constants.js";
import { LectureMasteryError } from "../features/mastery/errors.js";

type AuthenticatedRequest = express.Request & {
  user?: { id?: string };
};

export function validateMasteryQuery(q: express.Request["query"], reviews = false): string | null {
  const limit = q.limit === undefined ? 25 : Number(q.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return "limit must be an integer from 1 to 100.";
  if (q.state !== undefined && (reviews || !MASTERY_STATES.includes(String(q.state) as any))) return "Invalid mastery state.";
  const reviewStates = reviews
    ? ["DUE", "OVERDUE"]
    : ["INSUFFICIENT_EVIDENCE", "FRESH", "DUE_SOON", "DUE", "OVERDUE"];
  if (q.reviewState !== undefined && !reviewStates.includes(String(q.reviewState))) return "Invalid review state.";
  for (const key of ["subjectId", "cursor"]) if (q[key] !== undefined && (typeof q[key] !== "string" || !String(q[key]).trim() || String(q[key]).length > 200)) return `Invalid ${key}.`;
  return null;
}

export function createMasteryRouter(dependencies: {
  requireUser: express.RequestHandler;
  getMyMastery?: typeof getMyLectureMasteryWithRetention;
}): express.Router {
  const router = express.Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, private");
    next();
  });
  router.use(dependencies.requireUser);

  const user = (req: express.Request) => (req as AuthenticatedRequest).user?.id;
  const badQuery = (req: express.Request, reviews = false) => validateMasteryQuery(req.query, reviews);
  router.get("/", async (req, res) => {
    const userId = user(req);
    if (!userId) return res.status(401).json({ error: "Authentication required." });
    try { return res.json(await readMasteryDashboard(userId)); }
    catch { return res.status(500).json({ error: "Unable to load Mastery dashboard." }); }
  });
  router.get("/lectures", async (req, res) => {
    const userId = user(req);
    if (!userId) return res.status(401).json({ error: "Authentication required." });
    const error = badQuery(req);
    if (error) return res.status(400).json({ error });
    try {
      return res.json(await readMasteryLectures(userId, {
        state: req.query.state as string | undefined, reviewState: req.query.reviewState as string | undefined,
        subjectId: req.query.subjectId as string | undefined, cursor: req.query.cursor as string | undefined,
        limit: req.query.limit === undefined ? 25 : Number(req.query.limit),
      }));
    } catch { return res.status(500).json({ error: "Unable to load Mastery lectures." }); }
  });
  router.get("/reviews", async (req, res) => {
    const userId = user(req);
    if (!userId) return res.status(401).json({ error: "Authentication required." });
    const error = badQuery(req, true);
    if (error) return res.status(400).json({ error });
    try {
      return res.json(await readMasteryReviews(userId, {
        reviewState: req.query.reviewState as string, subjectId: req.query.subjectId as string | undefined,
        cursor: req.query.cursor as string | undefined, limit: req.query.limit === undefined ? 25 : Number(req.query.limit),
      }));
    } catch { return res.status(500).json({ error: "Unable to load Mastery reviews." }); }
  });

  router.get("/lectures/:lectureId", async (req, res) => {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required." });

    try {
      const fallback = dependencies.getMyMastery ?? getMyLectureMasteryWithRetention;
      const cached = await readMasteryLectureDetail(userId, req.params.lectureId);
      const result = cached ?? await fallback({ userId, lectureId: req.params.lectureId });
      return res.json(result);
    } catch (error) {
      if (error instanceof LectureMasteryError) {
        if (error.code === "LECTURE_NOT_FOUND") {
          return res.status(404).json({ error: error.message });
        }
        if (error.code === "INVALID_INPUT") {
          return res.status(400).json({ error: error.message });
        }
      }
      return res.status(500).json({ error: "Unable to load lecture Mastery." });
    }
  });

  return router;
}