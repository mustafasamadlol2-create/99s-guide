import express, { type RequestHandler } from "express";
import { isStudyFeatureEnabled } from "../features/study-core/featureFlags.js";
import { GroupFocusError } from "../features/group-focus/errors.js";
import {
  createGroupFocusRoomSchema,
  emptyGroupFocusBodySchema,
  groupFocusRoomIdSchema,
  groupFocusUserIdSchema,
  joinGroupFocusRoomSchema,
  myGroupFocusRoomsQuerySchema,
  publicGroupFocusRoomsQuerySchema,
  updateGroupFocusLectureSchema,
  updateGroupFocusStudyPlanSchema,
} from "../features/group-focus/schemas.js";
import type { GroupFocusService } from "../features/group-focus/service.js";
import {
  createGroupFocusRuntimeSummaryService,
  type GroupFocusRuntimeSummaryService,
} from "../features/group-focus/runtimeSummary.js";
import { issueGroupFocusCapability, verifyIssuedGroupFocusCapability } from "../features/group-focus/capability.js";
import type { GroupFocusCapabilityEnvironment } from "../../shared/group-focus-capability/keyring.js";
import { isGroupFocusPrincipalId } from "../../shared/group-focus-capability/contract.js";
import { isGroupFocusRuntimeReady } from "../features/group-focus/readiness.js";
import { resolveGroupFocusWorkerOrigin } from "../../shared/group-focus-realtime/workerOrigin.js";

export interface GroupFocusRouteDependencies {
  requireUser: RequestHandler;
  service: GroupFocusService;
  runtimeSummaryService?: GroupFocusRuntimeSummaryService;
  isEnabled?: () => boolean;
  capabilityEnvironment?: () => GroupFocusCapabilityEnvironment;
  capabilityNow?: () => Date;
  isRuntimeReady?: () => boolean;
  workerOrigin?: () => string;
}

type AuthenticatedRequest = express.Request & { user: { id: string } };

function userId(req: express.Request): string {
  return (req as AuthenticatedRequest).user.id;
}

function sendError(res: express.Response, error: unknown): express.Response {
  if (error instanceof GroupFocusError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  return res.status(500).json({
    error: "Group Focus request failed.",
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

function invalid(res: express.Response, message: string): express.Response {
  return res.status(400).json({ error: message, code: "INVALID_ROOM_CONFIGURATION" });
}

function parseRoomId(value: unknown): string | null {
  const parsed = groupFocusRoomIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function validEmptyBody(req: express.Request): boolean {
  return emptyGroupFocusBodySchema.safeParse(req.body ?? {}).success;
}

export function createGroupFocusJsonParser(): RequestHandler {
  const parser = express.json({ limit: "2mb" });
  return (req, res, next) => {
    parser(req, res, (error: unknown) => {
      if (!error) return next();
      const candidate = error as { status?: unknown; type?: unknown };
      if (candidate.status === 413 || candidate.type === "entity.too.large") {
        return res.status(413).json({
          error: "Group Focus request is too large.",
          code: "REQUEST_TOO_LARGE",
        });
      }
      if (error instanceof SyntaxError) {
        return res.status(400).json({
          error: "Group Focus request JSON is invalid.",
          code: "INVALID_REQUEST",
        });
      }
      return next(error);
    });
  };
}

export function createGroupFocusRouter(
  dependencies: GroupFocusRouteDependencies,
): express.Router {
  const router = express.Router();
  const runtimeSummaries = dependencies.runtimeSummaryService
    ?? createGroupFocusRuntimeSummaryService();
  const isEnabled = dependencies.isEnabled
    ?? (() => isStudyFeatureEnabled("GROUP_FOCUS_ENABLED"));
  const isRuntimeReady = dependencies.isRuntimeReady
    ?? (dependencies.isEnabled ? (() => true) : (() => isGroupFocusRuntimeReady()));

  // Keep disabled requests out of authentication and all Group Focus reads.
  router.use((_req, res, next) => {
    if (!isEnabled()) {
      return res.status(404).json({
        error: "Group Focus is not available.",
        code: "FEATURE_DISABLED",
      });
    }
    if (!isRuntimeReady()) {
      return res.status(503).json({
        error: "Group Focus realtime is not configured.",
        code: "RUNTIME_NOT_READY",
      });
    }
    return next();
  });
  // Cloudflare realtime verification is deliberately capability-based instead of
  // sharing signing secrets with the Worker. The short-lived token is verified
  // here (where the signing keys already live) and then reconciled against the
  // current canonical membership before the Worker can open a socket.
  router.post("/runtime/verify-capability", route(async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const token = typeof body?.capabilityToken === "string" ? body.capabilityToken : null;
    const requestedRoomId = parseRoomId(body?.roomId);
    if (!token || !requestedRoomId) {
      return res.status(400).json({ error: "Capability verification request is invalid.", code: "INVALID_REQUEST" });
    }
    try {
      const capabilityEnvironment = dependencies.capabilityEnvironment?.() ?? process.env;
      const capability = verifyIssuedGroupFocusCapability(
        token,
        capabilityEnvironment,
        dependencies.capabilityNow?.() ?? new Date(),
      );
      if (capability.roomId !== requestedRoomId) {
        return res.status(403).json({ error: "Capability room does not match.", code: "ROOM_CAPABILITY_MISMATCH" });
      }
      const context = await dependencies.service.getGroupFocusAuthorizationContext(
        capability.userId,
        capability.roomId,
      );
      if (
        !context
        || context.userId !== capability.userId
        || context.roomId !== capability.roomId
        || context.membershipId !== capability.membershipId
        || context.role !== capability.role
        || context.mode !== capability.mode
        || context.visibility !== capability.visibility
        || context.effectiveLectureId !== capability.effectiveLectureId
        || context.focusDurationSeconds !== capability.focusDurationSeconds
        || context.breakDurationSeconds !== capability.breakDurationSeconds
        || context.roundCount !== capability.roundCount
        || context.maxParticipants !== capability.maxParticipants
      ) {
        return res.status(403).json({ error: "Capability no longer matches canonical membership.", code: "AUTHORIZATION_REFRESH_REQUIRED" });
      }
      return res.set("Cache-Control", "no-store, private").json({ capability });
    } catch {
      return res.status(401).json({ error: "Capability verification failed.", code: "INVALID_CAPABILITY" });
    }
  }));

  // Capability-authenticated canonical reads are safe to expose to the realtime
  // Worker: a room member can only request the room encoded in their signed token,
  // and canonical membership is re-checked before returning data. This removes a
  // second Cloudflare secret as a hard dependency while retaining fail-closed auth.
  router.post("/runtime/snapshot", route(async (req, res) => {
    const authorization = req.get("authorization") ?? "";
    const match = authorization.match(/^\s*Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*$/iu);
    const token = match?.[1];
    const body = req.body as Record<string, unknown> | undefined;
    const roomId = parseRoomId(body?.roomId);
    const userIds = Array.isArray(body?.userIds) ? body?.userIds : null;
    if (
      !token
      || !roomId
      || !userIds
      || userIds.length > 10_000
      || userIds.some((value) => !isGroupFocusPrincipalId(value))
      || new Set(userIds as string[]).size !== userIds.length
    ) {
      return res.status(400).json({ error: "Canonical snapshot request is invalid.", code: "INVALID_SNAPSHOT" });
    }
    try {
      const capability = verifyIssuedGroupFocusCapability(
        token,
        dependencies.capabilityEnvironment?.() ?? process.env,
        dependencies.capabilityNow?.() ?? new Date(),
      );
      if (capability.roomId !== roomId) {
        return res.status(403).json({ error: "Capability room does not match.", code: "ROOM_CAPABILITY_MISMATCH" });
      }
      const context = await dependencies.service.getGroupFocusAuthorizationContext(
        capability.userId,
        roomId,
      );
      if (!context || context.membershipId !== capability.membershipId) {
        return res.status(403).json({ error: "Membership is no longer active.", code: "AUTHORIZATION_REFRESH_REQUIRED" });
      }
      const snapshot = await runtimeSummaries.getCanonicalSnapshot(roomId, userIds as string[]);
      return res.set("Cache-Control", "no-store, private").json(snapshot);
    } catch {
      return res.status(401).json({ error: "Capability verification failed.", code: "INVALID_CAPABILITY" });
    }
  }));

  router.use(dependencies.requireUser);

  router.post("/rooms", route(async (req, res) => {
    const parsed = createGroupFocusRoomSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, "Group Focus Room configuration is invalid.");
    try {
      const result = await dependencies.service.createRoom(userId(req), parsed.data);
      return res.status(result.idempotency === "CREATED" ? 201 : 200).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.post("/rooms/:roomId/capability", route(async (req, res) => {
    res.set({
      "Cache-Control": "no-store, private",
      Pragma: "no-cache",
    });
    const roomId = parseRoomId(req.params.roomId);
    if (!roomId) return invalid(res, "Group Focus Room ID is invalid.");
    if (!validEmptyBody(req)) return invalid(res, "Capability requests accept no fields.");
    try {
      const authenticatedUserId = userId(req);
      const context = await dependencies.service.getGroupFocusAuthorizationContext(
        authenticatedUserId,
        roomId,
      );
      if (
        !context
        || context.userId !== authenticatedUserId
        || context.roomId !== roomId
      ) {
        throw new GroupFocusError("ROOM_NOT_FOUND", "Group Focus Room was not found.");
      }
      const capabilityEnvironment = dependencies.capabilityEnvironment?.() ?? process.env;
      return res.json({
        ...issueGroupFocusCapability(
          context,
          capabilityEnvironment,
          dependencies.capabilityNow?.() ?? new Date(),
        ),
        workerUrl: dependencies.workerOrigin?.() ?? resolveGroupFocusWorkerOrigin(process.env),
      });
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.get("/rooms/:roomId/summary", route(async (req, res) => {
    res.set({
      "Cache-Control": "no-store, private",
      Pragma: "no-cache",
    });
    const roomId = parseRoomId(req.params.roomId);
    if (!roomId) return invalid(res, "Group Focus Room ID is invalid.");
    const authenticatedUserId = userId(req);
    let summary = await runtimeSummaries.getMySummary(authenticatedUserId, roomId);

    // In the same-origin Worker architecture the Durable Object keeps the frozen
    // terminal summary and the authenticated API pulls it on demand. This avoids
    // requiring a second Cloudflare machine secret while preserving server-side
    // validation, Study Events and Study Points as the final source of truth.
    if (!summary) {
      try {
        const context = await dependencies.service.getGroupFocusAuthorizationContext(
          authenticatedUserId,
          roomId,
        );
        if (context) {
          const capability = issueGroupFocusCapability(
            context,
            dependencies.capabilityEnvironment?.() ?? process.env,
            dependencies.capabilityNow?.() ?? new Date(),
          );
          const workerOrigin = dependencies.workerOrigin?.()
            ?? resolveGroupFocusWorkerOrigin(process.env);
          const response = await fetch(
            `${workerOrigin.replace(/\/$/u, "")}/group-focus/rooms/${encodeURIComponent(roomId)}/summary`,
            {
              method: "GET",
              headers: { Authorization: `Bearer ${capability.capabilityToken}` },
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (response.ok) {
            const frozenSummary = await response.json() as unknown;
            await runtimeSummaries.persistTerminalSummary(frozenSummary);
            summary = await runtimeSummaries.getMySummary(authenticatedUserId, roomId);
          }
        }
      } catch (error) {
        console.warn("[Group Focus] Terminal summary pull is not ready yet.", {
          errorCode: "GROUP_FOCUS_SUMMARY_PULL_PENDING",
          reason: error instanceof Error ? error.message : "unknown",
        });
      }
    }

    if (!summary) {
      return res.status(404).json({
        error: "Group Focus summary was not found.",
        code: "SUMMARY_NOT_FOUND",
      });
    }
    return res.json(summary);
  }));

  router.get("/rooms/public", route(async (req, res) => {
    const parsed = publicGroupFocusRoomsQuerySchema.safeParse(req.query);
    if (!parsed.success) return invalid(res, "Public Room query is invalid.");
    try {
      return res.json(await dependencies.service.listPublicRooms(parsed.data));
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.get("/rooms/mine", route(async (req, res) => {
    const parsed = myGroupFocusRoomsQuerySchema.safeParse(req.query);
    if (!parsed.success) return invalid(res, "My Rooms query is invalid.");
    try {
      return res.json(await dependencies.service.listMyRooms(userId(req), parsed.data));
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.get("/rooms/:roomId/members", route(async (req, res) => {
    const roomId = parseRoomId(req.params.roomId);
    if (!roomId) return invalid(res, "Group Focus Room ID is invalid.");
    try {
      const members = await dependencies.service.listRoomMembers(userId(req), roomId);
      return res.json({ members });
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.get("/rooms/:roomId", route(async (req, res) => {
    const roomId = parseRoomId(req.params.roomId);
    if (!roomId) return invalid(res, "Group Focus Room ID is invalid.");
    try {
      return res.json(await dependencies.service.getRoomDetail(userId(req), roomId));
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.post("/rooms/:roomId/join", route(async (req, res) => {
    const roomId = parseRoomId(req.params.roomId);
    const parsed = joinGroupFocusRoomSchema.safeParse(req.body ?? {});
    if (!roomId) return invalid(res, "Group Focus Room ID is invalid.");
    if (!parsed.success) return invalid(res, "Group Focus join details are invalid.");
    try {
      return res.status(200).json(
        await dependencies.service.joinRoom(userId(req), roomId, parsed.data),
      );
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.post("/rooms/:roomId/leave", route(async (req, res) => {
    const roomId = parseRoomId(req.params.roomId);
    if (!roomId) return invalid(res, "Group Focus Room ID is invalid.");
    if (!validEmptyBody(req)) return invalid(res, "Leave Room accepts no request fields.");
    try {
      const membership = await dependencies.service.leaveRoom(userId(req), roomId);
      return res.json({ membership });
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.post("/rooms/:roomId/members/:userId/remove", route(async (req, res) => {
    const roomId = parseRoomId(req.params.roomId);
    const targetUser = groupFocusUserIdSchema.safeParse(req.params.userId);
    if (!roomId || !targetUser.success) return invalid(res, "Group Focus identifier is invalid.");
    if (!validEmptyBody(req)) return invalid(res, "Member removal accepts no request fields.");
    try {
      const membership = await dependencies.service.removeMember(
        userId(req),
        roomId,
        targetUser.data,
      );
      return res.json({ membership });
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.post("/rooms/:roomId/close", route(async (req, res) => {
    const roomId = parseRoomId(req.params.roomId);
    if (!roomId) return invalid(res, "Group Focus Room ID is invalid.");
    if (!validEmptyBody(req)) return invalid(res, "Close Room accepts no request fields.");
    try {
      return res.json(await dependencies.service.closeRoom(userId(req), roomId));
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.post("/rooms/:roomId/invite/rotate", route(async (req, res) => {
    const roomId = parseRoomId(req.params.roomId);
    if (!roomId) return invalid(res, "Group Focus Room ID is invalid.");
    if (!validEmptyBody(req)) return invalid(res, "Invite rotation accepts no request fields.");
    try {
      return res.json(await dependencies.service.rotateInvite(userId(req), roomId));
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.put("/rooms/:roomId/me/study-plan", route(async (req, res) => {
    const roomId = parseRoomId(req.params.roomId);
    const parsed = updateGroupFocusStudyPlanSchema.safeParse(req.body);
    if (!roomId) return invalid(res, "Group Focus Room ID is invalid.");
    if (!parsed.success) return invalid(res, "A valid Group Focus study plan is required.");
    try {
      return res.json(
        await dependencies.service.updateMyStudyPlan(userId(req), roomId, parsed.data.studyPlan),
      );
    } catch (error) {
      return sendError(res, error);
    }
  }));

  router.patch("/rooms/:roomId/me/lecture", route(async (req, res) => {
    const roomId = parseRoomId(req.params.roomId);
    const parsed = updateGroupFocusLectureSchema.safeParse(req.body);
    if (!roomId) return invalid(res, "Group Focus Room ID is invalid.");
    if (!parsed.success) return invalid(res, "A valid canonical Lecture is required.");
    try {
      return res.json(
        await dependencies.service.updateMyLecture(userId(req), roomId, parsed.data.lectureId),
      );
    } catch (error) {
      return sendError(res, error);
    }
  }));

  return router;
}