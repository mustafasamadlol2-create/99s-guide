import express from "express";
import { getClientVisibleStudyFeatureFlags } from "../features/study-core/featureFlags.js";
import { isGroupFocusRuntimeReady } from "../features/group-focus/readiness.js";

export function createStudyFeatureFlagsRouter(): express.Router {
  const router = express.Router();
  router.get("/study/features", (_req, res) => {
    return res
      .set("Cache-Control", "no-store")
      .json({
        ...getClientVisibleStudyFeatureFlags(),
        GROUP_FOCUS_RUNTIME_READY: isGroupFocusRuntimeReady(),
      });
  });
  return router;
}
