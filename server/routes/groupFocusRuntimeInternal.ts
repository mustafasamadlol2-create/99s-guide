import express, { type RequestHandler } from "express";
import {
  GROUP_FOCUS_SUMMARY_MAX_BODY_BYTES,
  type GroupFocusRuntimeSnapshotRequest,
} from "../../shared/group-focus-reconciliation/contract.js";
import {
  verifyGroupFocusMachineRequest,
  type GroupFocusReconciliationEnvironment,
} from "../../shared/group-focus-reconciliation/signing.js";
import { isStudyFeatureEnabled } from "../features/study-core/featureFlags.js";
import {
  createGroupFocusRuntimeSummaryService,
  GroupFocusRuntimeSummaryError,
} from "../features/group-focus/runtimeSummary.js";

const snapshotRequestSchema = {
  safeParse(value: unknown): { success: true; data: GroupFocusRuntimeSnapshotRequest }
    | { success: false } {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { success: false };
    }
    const body = value as Record<string, unknown>;
    const keys = Object.keys(body).sort();
    const expected = ["roomId", "runtimeInstanceId", "runtimeRevision", "userIds"].sort();
    if (
      keys.length !== expected.length
      || !keys.every((key, index) => key === expected[index])
      || typeof body.roomId !== "string"
      || !UUID.test(body.roomId)
      || typeof body.runtimeInstanceId !== "string"
      || !RUNTIME_ID.test(body.runtimeInstanceId)
      || typeof body.runtimeRevision !== "number"
      || !Number.isSafeInteger(body.runtimeRevision)
      || body.runtimeRevision < 0
      || !Array.isArray(body.userIds)
      || body.userIds.length > 25
      || body.userIds.some((userId) => typeof userId !== "string" || !UUID.test(userId))
      || new Set(body.userIds).size !== body.userIds.length
    ) return { success: false };
    return { success: true, data: body as GroupFocusRuntimeSnapshotRequest };
  },
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const RUNTIME_ID = /^[A-Za-z0-9_-]{22}$/u;
const RAW_BODY = Symbol("group-focus-runtime-raw-body");
type RawBodyRequest = express.Request & { [RAW_BODY]?: Buffer };

export function createGroupFocusRuntimeJsonParser(): RequestHandler {
  const parser = express.json({
    limit: GROUP_FOCUS_SUMMARY_MAX_BODY_BYTES,
    type: "application/json",
    verify(req, _res, buffer) {
      (req as RawBodyRequest)[RAW_BODY] = Buffer.from(buffer);
    },
  });
  return (req, res, next) => {
    parser(req, res, (error: unknown) => {
      if (!error) return next();
      const candidate = error as { status?: unknown; type?: unknown };
      if (candidate.status === 413 || candidate.type === "entity.too.large") {
        return res.status(413).json({ error: "Request body is too large.", code: "BODY_TOO_LARGE" });
      }
      if (error instanceof SyntaxError) {
        return res.status(400).json({ error: "Request JSON is invalid.", code: "INVALID_JSON" });
      }
      return next(error);
    });
  };
}

export type GroupFocusRuntimeInternalService = ReturnType<
  typeof createGroupFocusRuntimeSummaryService
>;

export function createGroupFocusRuntimeInternalRouter(dependencies: {
  service?: GroupFocusRuntimeInternalService;
  environment?: () => GroupFocusReconciliationEnvironment;
  isEnabled?: () => boolean;
} = {}): express.Router {
  const router = express.Router();
  const service = dependencies.service ?? createGroupFocusRuntimeSummaryService();
  const isEnabled = dependencies.isEnabled
    ?? (() => isStudyFeatureEnabled("GROUP_FOCUS_ENABLED"));

  router.use((_req, res, next) => {
    if (!isEnabled()) {
      return res.status(404).json({
        error: "Group Focus is not available.",
        code: "FEATURE_DISABLED",
      });
    }
    next();
  });

  router.use((req, res, next) => {
    const path = req.originalUrl;
    const body = (req as RawBodyRequest)[RAW_BODY];
    if (
      typeof path !== "string"
      || path.includes("?")
      || !body
      || req.method !== "POST"
    ) {
      return res.status(401).json({ error: "Machine authentication failed.", code: "INVALID_MACHINE_AUTH" });
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(name, value);
      else if (Array.isArray(value)) headers.set(name, value.join(", "));
    }
    void verifyGroupFocusMachineRequest(
      dependencies.environment?.() ?? process.env,
      { method: req.method, path, body, headers },
    ).then((result) => {
      if (result.ok === false) {
        const status = result.code === "RECONCILIATION_NOT_CONFIGURED" ? 503 : 401;
        return res.status(status).json({
          error: "Machine authentication failed.",
          code: result.code,
        });
      }
      next();
    }).catch(() => {
      res.status(401).json({ error: "Machine authentication failed.", code: "INVALID_MACHINE_AUTH" });
    });
  });

  router.post("/snapshot", async (req, res) => {
    const parsed = snapshotRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Snapshot request is invalid.", code: "INVALID_SNAPSHOT" });
    }
    try {
      const snapshot = await service.getCanonicalSnapshot(
        parsed.data.roomId,
        parsed.data.userIds,
      );
      return res.set("Cache-Control", "no-store, private").json(snapshot);
    } catch (error) {
      if (error instanceof GroupFocusRuntimeSummaryError) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }
      return res.status(500).json({ error: "Canonical snapshot failed.", code: "SNAPSHOT_FAILED" });
    }
  });

  router.post("/summary", async (req, res) => {
    try {
      const acknowledgement = await service.persistTerminalSummary(req.body);
      return res.set("Cache-Control", "no-store, private").json(acknowledgement);
    } catch (error) {
      if (error instanceof GroupFocusRuntimeSummaryError) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }
      return res.status(500).json({ error: "Runtime summary failed.", code: "SUMMARY_FAILED" });
    }
  });

  return router;
}