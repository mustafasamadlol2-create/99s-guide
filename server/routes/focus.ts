import express, { type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { FocusError } from "../features/focus/errors.js";
import {
  abandonFocusSessionSchema,
  completeFocusSessionSchema,
  createFocusPlanSchema,
  focusPlanIdSchema,
  focusPlanListQuerySchema,
  focusSessionIdSchema,
  focusSessionTransitionSchema,
  focusBreakTransitionSchema,
  startFocusSessionSchema,
  updateFocusPlanSchema,
  resourceHandoffStartSchema,
  resourceHandoffReturnSchema,
  interruptionRecordSchema,
  focusMetricsQuerySchema,
  focusHistoryQuerySchema,
} from "../features/focus/schemas.js";
import type { FocusBackendService } from "../features/focus/types.js";
import { MASTERY_MEANINGFUL_FOCUS_SECONDS } from "../features/mastery/constants.js";
import { isGamificationEnabled as isGamificationFeatureEnabled } from "../features/gamification/featureGate.js";

export interface FocusRouteDependencies {
  requireUser: RequestHandler;
  service: FocusBackendService;
  broadcastInvalidation?(userId: string, event: FocusInvalidationPayload): void;
  isGamificationEnabled?: () => boolean;
  refreshAchievements?(userId: string): Promise<unknown>;
  refreshMastery?(userId: string, lectureId: string): Promise<unknown>;
  refreshChallenges?(
    userId: string,
    metricIds: readonly string[],
  ): Promise<unknown>;
}

export type FocusInvalidationResource =
  | "current-session"
  | "plans"
  | "break"
  | "history"
  | "metrics"
  | "summary"
  | "post-actions";

export interface FocusInvalidationPayload {
  eventId: string;
  changedAt: string;
  resources: FocusInvalidationResource[];
  sessionId?: string;
  planId?: string;
  originClientId?: string;
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function focusMutationInvalidation(
  path: string,
  responseBody: unknown,
  sessionParam: unknown,
  planParam: unknown,
  originClientId: string | undefined,
): FocusInvalidationPayload | null {
  const body = asRecord(responseBody);
  const session = asRecord(body.session);
  const plan = asRecord(body.plan);
  const pathSessionId = path.match(/^\/sessions\/([^/]+)/)?.[1];
  const pathPlanId = path.match(/^\/plans\/([^/]+)/)?.[1];
  const sessionId =
    (typeof session.id === "string" ? session.id : undefined) ??
    (typeof sessionParam === "string" ? sessionParam : undefined) ??
    (pathSessionId === "start" ? undefined : pathSessionId);
  const planId =
    (typeof plan.id === "string" ? plan.id : undefined) ??
    (typeof planParam === "string" ? planParam : undefined) ??
    pathPlanId;
  const status = typeof session.status === "string" ? session.status : "";
  const terminal = ["COMPLETED", "ABANDONED", "EXPIRED"].includes(status);
  const terminalResources: FocusInvalidationResource[] = [
    "history",
    "metrics",
    "summary",
    "post-actions",
  ];

  let resources: FocusInvalidationResource[];
  if (path.startsWith("/plans")) {
    resources = ["plans"];
  } else if (path.includes("/interruptions")) {
    if (body.metricUpdated !== true) return null;
    resources = ["history", "metrics"];
  } else if (path.includes("/break/")) {
    resources = [
      "current-session",
      "break",
      ...(terminal ? terminalResources : []),
    ];
  } else if (terminal || path.endsWith("/complete") || path.endsWith("/abandon")) {
    resources = ["current-session", ...terminalResources];
  } else {
    resources = ["current-session"];
  }

  const idempotency = body.idempotency;
  if (typeof idempotency === "string" &&
      !["FIRST_SEEN", "CREATED"].includes(idempotency)) {
    return null;
  }

  return {
    eventId: randomUUID(),
    changedAt: new Date().toISOString(),
    resources,
    ...(sessionId ? { sessionId } : {}),
    ...(planId ? { planId } : {}),
    ...(originClientId ? { originClientId } : {}),
  };
}

export function createFocusRouter(dependencies: FocusRouteDependencies): express.Router {
  const router = express.Router();
  router.use(dependencies.requireUser);
  router.use((req, res, next) => {
    if (!dependencies.broadcastInvalidation ||
        !["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      return next();
    }
    const authenticatedUserId = userId(req);
    const mutationLocals = res.locals as { focusMutationBody?: unknown };
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      mutationLocals.focusMutationBody = body;
      return originalJson(body);
    }) as typeof res.json;
    res.once("finish", () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      try {
        const event = focusMutationInvalidation(
          req.path,
          mutationLocals.focusMutationBody,
          req.params.sessionId,
          req.params.planId,
          /^[A-Za-z0-9._-]{8,128}$/.test(req.get("x-focus-client-id") ?? "")
            ? req.get("x-focus-client-id")!
            : undefined,
        );
        if (event) dependencies.broadcastInvalidation?.(authenticatedUserId, event);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown error";
        console.warn(`[Focus] Realtime invalidation failed: ${reason}`);
      }
    });
    return next();
  });

  router.get("/metrics", route(async (req, res) => {
    const parsed = focusMetricsQuerySchema.safeParse(req.query);
    if (!parsed.success) return invalid(res, "Focus metrics query is invalid.");
    try {
      return res.json(await dependencies.service.getMetrics(userId(req), parsed.data.period));
    } catch (error) {
      return sendError(res, error);
    }
  }));

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
      const plans = await dependencies.service.listPlans(userId(req), parsed.data.limit, {
        status: parsed.data.status,
        canonical: parsed.data.canonical === "1",
      });
      return res.json({ plans });
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.get("/plans/:planId", route(async (req, res) => {
    const parsedId = focusPlanIdSchema.safeParse(req.params.planId);
    if (!parsedId.success) return invalid(res, "Focus Plan ID is invalid.");
    try {
      const canonical = req.query.canonical === "1";
      const plan = await dependencies.service.getPlan(
        userId(req),
        parsedId.data,
        { canonical },
      );
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

  router.get("/history", route(async (req, res) => {
    const parsed = focusHistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) return invalid(res, "Focus history query is invalid.");
    try {
      return res.json(await dependencies.service.listHistory(userId(req), parsed.data));
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.get("/sessions/:sessionId/summary", route(async (req, res) => {
    const parsedId = focusSessionIdSchema.safeParse(req.params.sessionId);
    if (!parsedId.success) return invalid(res, "Focus Session ID is invalid.");
    try {
      return res.json(await dependencies.service.getSessionSummary(userId(req), parsedId.data));
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.get("/sessions/:sessionId/post-actions", route(async (req, res) => {
    const parsedId = focusSessionIdSchema.safeParse(req.params.sessionId);
    if (!parsedId.success) return invalid(res, "Focus Session ID is invalid.");
    try {
      return res.json(await dependencies.service.getPostFocusActionContext(
        userId(req), parsedId.data,
      ));
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.get("/sessions/:sessionId/break", route(async (req, res) => {
    const parsedId = focusSessionIdSchema.safeParse(req.params.sessionId);
    if (!parsedId.success) return invalid(res, "Focus Session ID is invalid.");
    try {
      return res.json(await dependencies.service.getBreak(userId(req), parsedId.data));
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.post("/sessions/:sessionId/break/start", route(async (req, res) => {
    const parsedId = focusSessionIdSchema.safeParse(req.params.sessionId);
    const parsedBody = focusBreakTransitionSchema.safeParse(req.body);
    if (!parsedId.success || !parsedBody.success) {
      return invalid(res, "Focus Break start request is invalid.");
    }
    try {
      const result = await dependencies.service.startBreak(
        userId(req),
        parsedId.data,
        parsedBody.data,
      );
      return res.status(result.idempotency === "FIRST_SEEN" ? 201 : 200).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.post("/sessions/:sessionId/break/pause", route(async (req, res) => {
    const parsedId = focusSessionIdSchema.safeParse(req.params.sessionId);
    const parsedBody = focusBreakTransitionSchema.safeParse(req.body);
    if (!parsedId.success || !parsedBody.success) {
      return invalid(res, "Focus Break pause request is invalid.");
    }
    try {
      const result = await dependencies.service.pauseBreak(
        userId(req),
        parsedId.data,
        parsedBody.data,
      );
      return res.status(result.idempotency === "FIRST_SEEN" ? 201 : 200).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.post("/sessions/:sessionId/break/resume", route(async (req, res) => {
    const parsedId = focusSessionIdSchema.safeParse(req.params.sessionId);
    const parsedBody = focusBreakTransitionSchema.safeParse(req.body);
    if (!parsedId.success || !parsedBody.success) {
      return invalid(res, "Focus Break resume request is invalid.");
    }
    try {
      const result = await dependencies.service.resumeBreak(
        userId(req),
        parsedId.data,
        parsedBody.data,
      );
      return res.status(result.idempotency === "FIRST_SEEN" ? 201 : 200).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.post("/sessions/:sessionId/break/return", route(async (req, res) => {
    const parsedId = focusSessionIdSchema.safeParse(req.params.sessionId);
    const parsedBody = focusBreakTransitionSchema.safeParse(req.body);
    if (!parsedId.success || !parsedBody.success) {
      return invalid(res, "Focus Break return request is invalid.");
    }
    try {
      return res.json(await dependencies.service.returnFromBreak(
        userId(req),
        parsedId.data,
        parsedBody.data,
      ));
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
      const result = await dependencies.service.completeSession(
        userId(req),
        parsedId.data,
        parsedBody.data,
      );
      if (result.idempotency === "FIRST_SEEN") {
        if (
          result.session.status === "COMPLETED" &&
          (result.session.activeSeconds ?? 0) >= MASTERY_MEANINGFUL_FOCUS_SECONDS
        ) {
          void dependencies.refreshMastery?.(
            userId(req),
            result.session.lectureId,
          ).catch(() => {
            // Projection failures must not change a committed Focus completion.
          });
        }
        const gamificationEnabled = dependencies.isGamificationEnabled
          ?? isGamificationFeatureEnabled;
        if (gamificationEnabled()) {
          try {
            await dependencies.refreshAchievements?.(userId(req));
          } catch (error) {
            const reason = error instanceof Error ? error.message : "unknown error";
            console.warn(`[Focus] Post-commit Gamification refresh failed: ${reason}`);
          }
          try {
            await dependencies.refreshChallenges?.(userId(req), [
              "focus.completed_sessions",
              "focus.verified_seconds",
              "consistency.qualifying_days",
            ]);
          } catch (error) {
            const reason = error instanceof Error ? error.message : "unknown error";
            console.warn(`[Focus] Post-commit Challenge refresh failed: ${reason}`);
          }
        }
      }
      return res.json(result);
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