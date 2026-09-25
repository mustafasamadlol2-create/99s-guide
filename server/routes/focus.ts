import express, { type RequestHandler } from "express";
import { FocusError } from "../features/focus/errors.js";
import {
  abandonFocusSessionSchema,
  completeFocusSessionSchema,
  createFocusPlanSchema,
  focusPlanIdSchema,
  focusPlanListQuerySchema,
  focusSessionIdSchema,
  focusSessionTransitionSchema,
  startFocusSessionSchema,
  updateFocusPlanSchema,
  resourceHandoffStartSchema,
  resourceHandoffReturnSchema,
  interruptionRecordSchema,
} from "../features/focus/schemas.js";
import type { FocusBackendService } from "../features/focus/types.js";

export interface FocusRouteDependencies {
  requireUser: RequestHandler;
  service: FocusBackendService;
}

type AuthenticatedRequest = express.Request & { user: { id: string } };

function userId(req: express.Request): string {
  return (req as AuthenticatedRequest).user.id;
}

function sendError(res: express.Response, error: unknown): express.Response {
  if (error instanceof FocusError) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code,
      ...(error.details ? { details: error.details } : {}),
    });
  }
  return res.status(500).json({
    error: "Focus request failed.",
    code: "INTERNAL_ERROR",
  });
}

function route(
  handler: (req: express.Request, res: express.Response) => Promise<unknown>,
): RequestHandler {
  return (req, res) => {
    void handler(req, res).catch((error: unknown) => sendError(res, error));
  };
}

function invalid(res: express.Response, error: string): express.Response {
  return res.status(400).json({ error, code: "INVALID_REQUEST" });
}

export function createFocusRouter(dependencies: FocusRouteDependencies): express.Router {
  const router = express.Router();
  router.use(dependencies.requireUser);

  router.post("/plans", route(async (req, res) => {
    const parsed = createFocusPlanSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, "Focus Plan request is invalid.");
    try {
      const plan = await dependencies.service.createPlan(userId(req), parsed.data);
      return res.status(201).json({ plan });
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.get("/plans", route(async (req, res) => {
    const parsed = focusPlanListQuerySchema.safeParse(req.query);
    if (!parsed.success) return invalid(res, "Focus Plan query is invalid.");
    try {
      const plans = await dependencies.service.listPlans(userId(req), parsed.data.limit);
      return res.json({ plans });
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.get("/plans/:planId", route(async (req, res) => {
    const parsedId = focusPlanIdSchema.safeParse(req.params.planId);
    if (!parsedId.success) return invalid(res, "Focus Plan ID is invalid.");
    try {
      const plan = await dependencies.service.getPlan(userId(req), parsedId.data);
      return res.json({ plan });
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.patch("/plans/:planId", route(async (req, res) => {
    const parsedId = focusPlanIdSchema.safeParse(req.params.planId);
    const parsedBody = updateFocusPlanSchema.safeParse(req.body);
    if (!parsedId.success || !parsedBody.success) {
      return invalid(res, "Focus Plan update is invalid.");
    }
    try {
      const plan = await dependencies.service.updatePlan(
        userId(req),
        parsedId.data,
        parsedBody.data,
      );
      return res.json({ plan });
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.post("/plans/:planId/archive", route(async (req, res) => {
    const parsedId = focusPlanIdSchema.safeParse(req.params.planId);
    if (!parsedId.success) return invalid(res, "Focus Plan ID is invalid.");
    try {
      const plan = await dependencies.service.archivePlan(userId(req), parsedId.data);
      return res.json({ plan });
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.post("/sessions/start", route(async (req, res) => {
    const parsed = startFocusSessionSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, "Focus Session start request is invalid.");
    try {
      const result = await dependencies.service.startSession(userId(req), parsed.data);
      return res.status(result.idempotency === "FIRST_SEEN" ? 201 : 200).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.get("/sessions/current", route(async (req, res) => {
    try {
      return res.json(await dependencies.service.currentSession(userId(req)));
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.post("/sessions/:sessionId/pause", route(async (req, res) => {
    const parsedId = focusSessionIdSchema.safeParse(req.params.sessionId);
    const parsedBody = focusSessionTransitionSchema.safeParse(req.body);
    if (!parsedId.success || !parsedBody.success) {
      return invalid(res, "Focus Session pause request is invalid.");
    }
    try {
      return res.json(await dependencies.service.pauseSession(
        userId(req),
        parsedId.data,
        parsedBody.data,
      ));
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.post("/sessions/:sessionId/resume", route(async (req, res) => {
    const parsedId = focusSessionIdSchema.safeParse(req.params.sessionId);
    const parsedBody = focusSessionTransitionSchema.safeParse(req.body);
    if (!parsedId.success || !parsedBody.success) {
      return invalid(res, "Focus Session resume request is invalid.");
    }
    try {
      return res.json(await dependencies.service.resumeSession(
        userId(req),
        parsedId.data,
        parsedBody.data,
      ));
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.post("/sessions/:sessionId/complete", route(async (req, res) => {
    const parsedId = focusSessionIdSchema.safeParse(req.params.sessionId);
    const parsedBody = completeFocusSessionSchema.safeParse(req.body);
    if (!parsedId.success || !parsedBody.success) {
      return invalid(res, "Focus Session completion request is invalid.");
    }
    try {
      return res.json(await dependencies.service.completeSession(
        userId(req),
        parsedId.data,
        parsedBody.data,
      ));
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.post("/sessions/:sessionId/abandon", route(async (req, res) => {
    const parsedId = focusSessionIdSchema.safeParse(req.params.sessionId);
    const parsedBody = abandonFocusSessionSchema.safeParse(req.body);
    if (!parsedId.success || !parsedBody.success) {
      return invalid(res, "Focus Session abandonment request is invalid.");
    }
    try {
      return res.json(await dependencies.service.abandonSession(
        userId(req),
        parsedId.data,
        parsedBody.data,
      ));
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.post("/sessions/:sessionId/handoff/start", route(async (req, res) => {
    const parsedId = focusSessionIdSchema.safeParse(req.params.sessionId);
    const parsedBody = resourceHandoffStartSchema.safeParse(req.body);
    if (!parsedId.success || !parsedBody.success) return invalid(res, "Resource handoff start request is invalid.");
    try {
      const result = await dependencies.service.startResourceHandoff(
        userId(req), parsedId.data, parsedBody.data,
      );
      return res.status(result.idempotency === "FIRST_SEEN" ? 201 : 200).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.post("/sessions/:sessionId/handoff/return", route(async (req, res) => {
    const parsedId = focusSessionIdSchema.safeParse(req.params.sessionId);
    const parsedBody = resourceHandoffReturnSchema.safeParse(req.body);
    if (!parsedId.success || !parsedBody.success) return invalid(res, "Resource handoff return request is invalid.");
    try {
      return res.json(await dependencies.service.returnFromResourceHandoff(
        userId(req), parsedId.data, parsedBody.data,
      ));
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.post("/sessions/:sessionId/interruptions", route(async (req, res) => {
    const parsedId = focusSessionIdSchema.safeParse(req.params.sessionId);
    const parsedBody = interruptionRecordSchema.safeParse(req.body);
    if (!parsedId.success || !parsedBody.success) return invalid(res, "Focus interruption request is invalid.");
    try {
      const result = await dependencies.service.recordInterruption(
        userId(req), parsedId.data, parsedBody.data,
      );
      return res.status(result.idempotency === "FIRST_SEEN" ? 201 : 200).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  }));

  return router;
}

export function createFocusJsonParser(): express.Router {
  const parser = express.Router();
  parser.use(express.json({ limit: "32kb" }));
  parser.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    const typed = error as { type?: string };
    if (typed?.type === "entity.too.large") {
      return res.status(413).json({ error: "Focus request is too large.", code: "REQUEST_TOO_LARGE" });
    }
    if (typed?.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Invalid Focus JSON.", code: "INVALID_REQUEST" });
    }
    return next(error);
  });
  return parser;
}