import express, { type RequestHandler } from "express";
import {
  MAX_PERSONALIZATION_CLOUD_RECORD_BYTES,
  parsePersonalizationConfig,
  type PersonalizationConfigV1,
} from "../../shared/personalization.js";
import {
  PersonalizationSyncError,
  type PersonalizationWorkerResult,
} from "../services/personalizationSync.js";

export interface PersonalizationRouteDependencies {
  requireUser: RequestHandler;
  isEnabled: () => boolean;
  getCloud: (userId: string) => Promise<PersonalizationWorkerResult>;
  putCloud: (
    userId: string,
    payload: {
      config: PersonalizationConfigV1;
      intentId: string;
      knownRevision: string | null;
    },
  ) => Promise<PersonalizationWorkerResult>;
}

function sendSyncError(res: express.Response, error: unknown): express.Response {
  if (error instanceof PersonalizationSyncError) {
    const headers: Record<string, string> = {};
    if (error.retryAfter) headers["Retry-After"] = error.retryAfter;
    return res.status(error.status).set(headers).json({
      error: error.message,
      retryable: error.retryable,
    });
  }
  return res.status(503).json({
    error: "Personalization sync is unavailable.",
    retryable: true,
  });
}

export function createPersonalizationRouter(
  dependencies: PersonalizationRouteDependencies,
): express.Router {
  const router = express.Router();

  router.get("/", dependencies.requireUser, async (req, res) => {
    if (!dependencies.isEnabled()) {
      return res.json({ status: "disabled", record: null });
    }

    try {
      const result = await dependencies.getCloud(
        (req as express.Request & { user: { id: string } }).user.id,
      );
      return res.json(result);
    } catch (error) {
      return sendSyncError(res, error);
    }
  });

  router.put("/", dependencies.requireUser, async (req, res) => {
    if (!dependencies.isEnabled()) {
      return res.json({ status: "disabled" });
    }

    const body = req.body;
    let bodyBytes = 0;
    try {
      bodyBytes = Buffer.byteLength(JSON.stringify(body ?? null), "utf8");
    } catch {
      return res.status(400).json({ error: "Invalid personalization payload." });
    }
    if (bodyBytes > MAX_PERSONALIZATION_CLOUD_RECORD_BYTES) {
      return res.status(413).json({ error: "Personalization record is too large." });
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !["config", "intentId", "knownRevision"].includes(key)) ||
      typeof body.intentId !== "string" ||
      !/^[A-Za-z0-9._:-]{8,160}$/.test(body.intentId) ||
      (body.knownRevision !== null &&
        (typeof body.knownRevision !== "string" || body.knownRevision.length > 256))
    ) {
      return res.status(400).json({ error: "Invalid personalization payload." });
    }
    const config = parsePersonalizationConfig(body.config);
    if (!config) return res.status(400).json({ error: "Invalid personalization config." });

    try {
      const result = await dependencies.putCloud(
        (req as express.Request & { user: { id: string } }).user.id,
        {
        config,
        intentId: body.intentId,
        knownRevision: body.knownRevision,
        },
      );
      return res.json(result);
    } catch (error) {
      return sendSyncError(res, error);
    }
  });

  return router;
}

export function createPersonalizationJsonParser(): express.Router {
  const parser = express.Router();
  parser.use(express.json({ limit: "32kb" }));
  parser.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error?.type === "entity.too.large") {
      return res.status(413).json({ error: "Personalization request is too large." });
    }
    if (error?.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Invalid personalization JSON." });
    }
    return next(error);
  });
  return parser;
}