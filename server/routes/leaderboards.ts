import express, { type RequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../services/prismaClient.js";
import { decodeLeaderboardCursor } from "../features/leaderboard/cursor.js";
import { LeaderboardError } from "../features/leaderboard/errors.js";
import {
  getLeaderboardPage,
  getMyLeaderboardRank,
  parseLeaderboardPageSize,
} from "../features/leaderboard/queries.js";
import {
  finalizeLeaderboardSeason,
  rebuildLeaderboardSnapshot,
} from "../features/leaderboard/snapshots.js";
import { parseLeaderboardScope } from "../features/leaderboard/seasons.js";
import { reconcileLeaderboardSnapshot } from "../features/leaderboard/reconciliation.js";

function errorStatus(error: LeaderboardError): number {
  switch (error.code) {
    case "LEADERBOARD_INVALID_INPUT":
    case "LEADERBOARD_CURSOR_INVALID":
      return 400;
    case "LEADERBOARD_SEASON_NOT_FOUND":
    case "LEADERBOARD_SNAPSHOT_NOT_FOUND":
      return 404;
    case "LEADERBOARD_CURSOR_EXPIRED":
      return 410;
    case "LEADERBOARD_SEASON_NOT_FINALIZABLE":
    case "LEADERBOARD_SEASON_CONFIGURATION_CONFLICT":
      return 409;
    case "LEADERBOARD_SEASON_CONFIGURATION_MISSING":
    case "LEADERBOARD_SNAPSHOT_INCONSISTENT":
    case "LEADERBOARD_POINTS_COMPATIBILITY_CONFLICT":
    case "LEADERBOARD_POINTS_LEDGER_ONLY_NOT_READY":
    case "LEADERBOARD_AGGREGATE_OVERFLOW":
      return 503;
  }
}

function sendLeaderboardError(
  res: express.Response,
  error: unknown,
): express.Response {
  if (error instanceof LeaderboardError) {
    return res.status(errorStatus(error)).json({
      error: error.message,
      code: error.code,
    });
  }
  return res.status(500).json({
    error: "Leaderboard request failed.",
    code: "LEADERBOARD_INTERNAL_ERROR",
  });
}

function authenticatedUserId(req: express.Request): string | null {
  const userId = (req as express.Request & { user?: { id?: unknown } }).user?.id;
  return typeof userId === "string" && userId.length > 0 ? userId : null;
}

function queryString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new LeaderboardError(
      "LEADERBOARD_INVALID_INPUT",
      `${name} must be a single string value.`,
    );
  }
  return value;
}

function requestBodyIsEmpty(req: express.Request): boolean {
  return req.body === undefined
    || req.body === null
    || (
      typeof req.body === "object"
      && !Array.isArray(req.body)
      && Object.keys(req.body).length === 0
    );
}

export function createLeaderboardRouter(dependencies: {
  requireUser: RequestHandler;
  database?: PrismaClient;
}): express.Router {
  const router = express.Router();
  const database = dependencies.database ?? getPrisma() as PrismaClient;
  router.use(dependencies.requireUser);

  router.get("/leaderboards/:scope", async (req, res) => {
    const scope = parseLeaderboardScope(req.params.scope);
    if (!scope) {
      return res.status(400).json({
        error: "Leaderboard scope is invalid.",
        code: "LEADERBOARD_INVALID_SCOPE",
      });
    }
    const viewerId = authenticatedUserId(req);
    if (!viewerId) {
      return res.status(401).json({
        error: "Authentication required.",
        code: "AUTHENTICATION_REQUIRED",
      });
    }
    try {
      const seasonKey = queryString(req.query.seasonKey, "seasonKey");
      const cursorValue = queryString(req.query.cursor, "cursor");
      const limit = parseLeaderboardPageSize(req.query.limit);
      const cursor = cursorValue
        ? decodeLeaderboardCursor(cursorValue)
        : undefined;
      const result = await getLeaderboardPage({
        viewerId,
        scope,
        ...(seasonKey ? { seasonKey } : {}),
        limit,
        ...(cursor ? { cursor } : {}),
        database,
      });
      return res
        .set("Cache-Control", "private, no-store")
        .json(result);
    } catch (error) {
      return sendLeaderboardError(res, error);
    }
  });

  router.get("/me/leaderboard-rank", async (req, res) => {
    const scope = parseLeaderboardScope(req.query.scope);
    if (!scope) {
      return res.status(400).json({
        error: "Leaderboard scope is invalid.",
        code: "LEADERBOARD_INVALID_SCOPE",
      });
    }
    const viewerId = authenticatedUserId(req);
    if (!viewerId) {
      return res.status(401).json({
        error: "Authentication required.",
        code: "AUTHENTICATION_REQUIRED",
      });
    }
    try {
      const seasonKey = queryString(req.query.seasonKey, "seasonKey");
      const result = await getMyLeaderboardRank({
        viewerId,
        scope,
        ...(seasonKey ? { seasonKey } : {}),
        database,
      });
      return res
        .set("Cache-Control", "private, no-store")
        .json(result);
    } catch (error) {
      return sendLeaderboardError(res, error);
    }
  });
  return router;
}

export function createAdminLeaderboardRouter(dependencies: {
  requireAdmin: RequestHandler;
  database?: PrismaClient;
}): express.Router {
  const router = express.Router();
  const database = dependencies.database ?? getPrisma() as PrismaClient;
  router.use(dependencies.requireAdmin);

  router.post("/seasons/:seasonId/rebuild", async (req, res) => {
    if (!requestBodyIsEmpty(req)) {
      return res.status(400).json({
        error: "Rebuild accepts no client-provided score or season values.",
        code: "LEADERBOARD_INVALID_REBUILD_REQUEST",
      });
    }
    try {
      const snapshot = await rebuildLeaderboardSnapshot({
        seasonId: req.params.seasonId,
      }, database);
      return res
        .set("Cache-Control", "private, no-store")
        .json({
          seasonId: snapshot.seasonId,
          snapshotId: snapshot.id,
          snapshotType: snapshot.snapshotType,
          revision: snapshot.revision,
          generatedAt: snapshot.generatedAt.toISOString(),
          scoreThrough: snapshot.scoreThrough.toISOString(),
          entryCount: snapshot.entryCount,
          sourceFingerprint: snapshot.sourceFingerprint,
        });
    } catch (error) {
      return sendLeaderboardError(res, error);
    }
  });

  router.post("/seasons/:seasonId/finalize", async (req, res) => {
    if (!requestBodyIsEmpty(req)) {
      return res.status(400).json({
        error: "Finalization accepts no client-provided score or date values.",
        code: "LEADERBOARD_INVALID_FINALIZE_REQUEST",
      });
    }
    try {
      const result = await finalizeLeaderboardSeason({
        seasonId: req.params.seasonId,
      }, database);
      return res
        .set("Cache-Control", "private, no-store")
        .json({
          season: {
            id: result.season.id,
            scope: result.season.scope,
            seasonKey: result.season.seasonKey,
            status: result.season.status,
            closedAt: result.season.closedAt?.toISOString() ?? null,
          },
          snapshotId: result.snapshot.id,
          revision: result.snapshot.revision,
          generatedAt: result.snapshot.generatedAt.toISOString(),
          scoreThrough: result.snapshot.scoreThrough.toISOString(),
          entryCount: result.snapshot.entryCount,
          reused: result.reused,
        });
    } catch (error) {
      return sendLeaderboardError(res, error);
    }
  });

  router.get("/seasons/:seasonId/reconciliation", async (req, res) => {
    try {
      const snapshotId = queryString(req.query.snapshotId, "snapshotId");
      const result = await reconcileLeaderboardSnapshot({
        seasonId: req.params.seasonId,
        ...(snapshotId ? { snapshotId } : {}),
      }, database);
      return res
        .set("Cache-Control", "private, no-store")
        .json(result);
    } catch (error) {
      return sendLeaderboardError(res, error);
    }
  });

  router.post("/seasons/:seasonId/reconciliation/repair", async (req, res) => {
    const body = req.body;
    if (
      body !== undefined
      && body !== null
      && (
        typeof body !== "object"
        || Array.isArray(body)
        || Object.keys(body).some((key) => key !== "snapshotId")
        || (body.snapshotId !== undefined && (
          typeof body.snapshotId !== "string"
          || body.snapshotId.length < 1
          || body.snapshotId.length > 128
        ))
      )
    ) {
      return res.status(400).json({
        error: "Repair accepts only an optional snapshot ID.",
        code: "LEADERBOARD_INVALID_RECONCILIATION_REQUEST",
      });
    }
    try {
      const result = await reconcileLeaderboardSnapshot({
        seasonId: req.params.seasonId,
        ...(typeof body?.snapshotId === "string"
          ? { snapshotId: body.snapshotId }
          : {}),
        repair: true,
      }, database);
      return res
        .set("Cache-Control", "private, no-store")
        .json(result);
    } catch (error) {
      return sendLeaderboardError(res, error);
    }
  });
  return router;
}