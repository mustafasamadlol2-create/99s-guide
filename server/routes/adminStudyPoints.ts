import express, {
  type RequestHandler,
} from "express";
import type { PrismaClient } from "@prisma/client";
import { reconcileStudyPointsAccount } from "../features/study-points/reconciliation.js";
import { StudyPointsError } from "../features/study-points/errors.js";
import { assertValidStudyPointsUserId } from "../features/study-points/validation.js";
import { getPrisma } from "../services/prismaClient.js";

type AdminStudyPointsRequest = express.Request & {
  user?: { id?: string; role?: string };
};

export function createAdminStudyPointsJsonParser(): RequestHandler {
  const parser = express.json({
    limit: "1kb",
    type: ["application/json", "application/*+json"],
  });
  return (req, res, next) => {
    parser(req, res, (error: unknown) => {
      if (!error) return next();
      const candidate = error as { status?: unknown; type?: unknown };
      if (candidate.status === 413 || candidate.type === "entity.too.large") {
        return res.status(413).json({
          error: "Study Points repair request is too large.",
          code: "BODY_TOO_LARGE",
        });
      }
      if (error instanceof SyntaxError) {
        return res.status(400).json({
          error: "Request JSON is invalid.",
          code: "INVALID_JSON",
        });
      }
      return next(error);
    });
  };
}

function validUserId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && !value.includes("\0");
}

function sendStudyPointsError(
  res: express.Response,
  error: unknown,
): express.Response {
  if (error instanceof StudyPointsError) {
    if (error.code === "POINTS_USER_NOT_FOUND") {
      return res.status(404).json({ error: "User was not found.", code: error.code });
    }
    if (error.code.startsWith("POINTS_INVALID_")) {
      return res.status(400).json({ error: "Study Points request is invalid.", code: error.code });
    }
  }
  console.error("[StudyPointsAdmin] Reconciliation operation failed.");
  return res.status(500).json({
    error: "Study Points reconciliation is unavailable.",
    code: "STUDY_POINTS_RECONCILIATION_FAILED",
  });
}

export function createAdminStudyPointsRouter(dependencies: {
  requireAdmin: RequestHandler;
  database?: PrismaClient;
}): express.Router {
  const router = express.Router();
  const database = dependencies.database ?? getPrisma() as PrismaClient;
  router.use(dependencies.requireAdmin);

  router.get("/users/:userId/reconciliation", async (req, res) => {
    const userId = req.params.userId;
    if (!validUserId(userId)) {
      return res.status(400).json({ error: "User ID is invalid.", code: "INVALID_USER_ID" });
    }
    try {
      const result = await reconcileStudyPointsAccount({ userId }, database);
      return res
        .set("Cache-Control", "no-store, private")
        .json(result);
    } catch (error) {
      return sendStudyPointsError(res, error);
    }
  });

  router.post("/users/:userId/reconciliation/repair-projection", async (req, res) => {
    const userId = req.params.userId;
    if (!validUserId(userId)) {
      return res.status(400).json({ error: "User ID is invalid.", code: "INVALID_USER_ID" });
    }
    if (
      req.body === undefined
      && ((Number(req.get("content-length") ?? "0") > 0)
        || req.headers["transfer-encoding"] !== undefined)
    ) {
      return res.status(415).json({
        error: "Repair requests must use a tiny JSON object.",
        code: "INVALID_REPAIR_REQUEST",
      });
    }
    if (
      req.body !== undefined
      && req.body !== null
      && (
        typeof req.body !== "object"
        || Array.isArray(req.body)
        || Object.keys(req.body).length !== 0
      )
    ) {
      return res.status(400).json({
        error: "Repair accepts no accounting values.",
        code: "INVALID_REPAIR_REQUEST",
      });
    }
    try {
      assertValidStudyPointsUserId(userId);
      const before = await reconcileStudyPointsAccount({ userId }, database);
      const after = await reconcileStudyPointsAccount({
        userId,
        repairProjection: true,
      }, database);
      return res
        .set("Cache-Control", "no-store, private")
        .json({
          before,
          after,
          status: after.status === "LEDGER_INVARIANT_FAILURE"
            ? after.status
            : after.repaired ? "IN_SYNC" : after.status,
          reconciliationFingerprint: after.reconciliationFingerprint,
          repaired: after.repaired,
        });
    } catch (error) {
      return sendStudyPointsError(res, error);
    }
  });
  return router;
}