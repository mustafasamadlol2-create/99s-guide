import express from "express";
import {
  getMyLectureMastery,
} from "../features/mastery/refresh.js";
import { LectureMasteryError } from "../features/mastery/errors.js";

type AuthenticatedRequest = express.Request & {
  user?: { id?: string };
};

export function createMasteryRouter(dependencies: {
  requireUser: express.RequestHandler;
  getMyMastery?: typeof getMyLectureMastery;
}): express.Router {
  const router = express.Router();
  router.use(dependencies.requireUser);

  router.get("/lectures/:lectureId", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, private");
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required." });

    try {
      const result = await (dependencies.getMyMastery ?? getMyLectureMastery)({
        userId,
        lectureId: req.params.lectureId,
      });
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