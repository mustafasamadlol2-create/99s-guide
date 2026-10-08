import express from "express";
import { getClientVisibleStudyFeatureFlags } from "../features/study-core/featureFlags.js";

export function createStudyFeatureFlagsRouter(): express.Router {
  const router = express.Router();
  router.get("/study/features", (_req, res) => {
    return res
      .set("Cache-Control", "no-store")
      .json(getClientVisibleStudyFeatureFlags());
  });
  return router;
}
