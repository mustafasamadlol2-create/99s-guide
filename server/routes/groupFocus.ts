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
} from "../features/group-focus/schemas.js";
import type { GroupFocusService } from "../features/group-focus/service.js";
import { issueGroupFocusCapability } from "../features/group-focus/capability.js";
import type { GroupFocusCapabilityEnvironment } from "../../shared/group-focus-capability/keyring.js";

export interface GroupFocusRouteDependencies {
  requireUser: RequestHandler;
  service: GroupFocusService;
  isEnabled?: () => boolean;
  capabilityEnvironment?: () => GroupFocusCapabilityEnvironment;
  capabilityNow?: () => Date;
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
  const parser = express.json({ limit: "32kb" });
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
  const isEnabled = dependencies.isEnabled
    ?? (() => isStudyFeatureEnabled("GROUP_FOCUS_ENABLED"));

  // Keep disabled requests out of authentication and all Group Focus reads.
  router.use((_req, res, next) => {
    if (!isEnabled()) {
      return res.status(404).json({
        error: "Group Focus is not available.",
        code: "FEATURE_DISABLED",
      });
    }
    return next();
  });
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
      return res.json(issueGroupFocusCapability(
        context,
        dependencies.capabilityEnvironment?.() ?? process.env,
        dependencies.capabilityNow?.() ?? new Date(),
      ));
    } catch (error) {
      return sendError(res, error);
    }
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