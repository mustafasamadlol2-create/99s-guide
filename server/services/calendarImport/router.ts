import express, { type RequestHandler } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { mkdirSync } from "node:fs";
import { extname } from "node:path";
import { AIServiceError } from "../ai/errors.js";
import { CalendarImportService } from "./service.js";

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
  "image/tiff",
  "image/bmp",
  "image/gif",
  "application/octet-stream",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".avif", ".tif", ".tiff", ".bmp", ".gif",
]);

function errorResponse(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof AIServiceError) {
    const status = error.code === "AI_CONFIG_ERROR" ? 503
      : error.code === "AI_INPUT_TOO_LARGE" ? 413
        : error.code === "AI_INPUT_UNSUPPORTED" ? 415
          : 400;
    return { status, body: { error: error.code, message: error.publicMessage } };
  }
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  if (code === "P2021" || code === "P2022") {
    return {
      status: 503,
      body: {
        error: "CALENDAR_IMPORT_DB_NOT_READY",
        message: "Calendar import database migration is not applied yet. Redeploy the backend with Prisma migrations enabled.",
      },
    };
  }
  if (["P1001", "P1002", "P1008", "P1017"].includes(code)) {
    return {
      status: 503,
      body: {
        error: "CALENDAR_IMPORT_DB_UNAVAILABLE",
        message: "The calendar database is temporarily unavailable. Please retry after the backend reconnects.",
      },
    };
  }
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: "CALENDAR_IMPORT_INVALID",
        message: "Calendar import data failed validation. Please review the selected source and try again.",
      },
    };
  }
  console.error("[CalendarImport] request failed", error);
  return {
    status: 500,
    body: {
      error: "CALENDAR_IMPORT_FAILED_TO_START",
      message: "Calendar import could not start on the server. Please retry after the backend deployment completes.",
    },
  };
}

function userId(req: express.Request): string {
  return String((req as express.Request & { user: { id: string } }).user.id);
}

function parseTargetGroups(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string" || !value.trim()) return ["ALL"];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // The comma-separated form remains supported for non-browser clients.
  }
  return value.split(",");
}

export function createCalendarImportRouter(options: {
  service: CalendarImportService;
  requireAdmin: RequestHandler;
  sourceRoot: string;
}): express.Router {
  const router = express.Router();
  // Multer's disk destination must exist before the first request. Creating it
  // asynchronously after route registration could race the first upload on a
  // freshly started Render instance.
  mkdirSync(options.sourceRoot, { recursive: true, mode: 0o700 });
  const upload = multer({
    dest: options.sourceRoot,
    limits: { files: 20, fileSize: 100 * 1024 * 1024, fieldSize: 1024 * 1024 + 16 * 1024 },
    fileFilter: (_req, file, callback) => {
      const mime = file.mimetype.trim().toLowerCase();
      callback(null, ALLOWED_MIMES.has(mime) || ALLOWED_EXTENSIONS.has(extname(file.originalname).toLowerCase()));
    },
  });

  router.post("/", options.requireAdmin, upload.array("files", 20), async (req, res) => {
    const files = (req.files ?? []) as Express.Multer.File[];
    try {
      const pastedText = typeof req.body?.text === "string" ? req.body.text : undefined;
      if (files.length === 0 && !pastedText?.trim()) {
        res.status(400).json({ error: "CALENDAR_IMPORT_NO_SOURCE", message: "Upload schedule files or paste schedule text." });
        return;
      }
      if (files.length > 0 && pastedText?.trim()) {
        res.status(400).json({ error: "CALENDAR_IMPORT_MULTIPLE_SOURCES", message: "Choose either files or pasted text, not both." });
        return;
      }
      const rawGroups = req.body?.defaultTargetGroups;
      const groups = parseTargetGroups(rawGroups);
      const job = await options.service.start(
        userId(req),
        files.map((file) => ({
          path: file.path,
          originalName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
        })),
        groups,
        pastedText,
      );
      res.status(202).json(job);
    } catch (error) {
      await Promise.all(files.map((file) => import("node:fs/promises").then(({ unlink }) => unlink(file.path).catch(() => {}))));
      const response = errorResponse(error);
      res.status(response.status).json(response.body);
    }
  });

  router.get("/:id", options.requireAdmin, async (req, res) => {
    try {
      const job = await options.service.get(userId(req), req.params.id);
      if (!job) {
        res.status(404).json({ error: "CALENDAR_IMPORT_NOT_FOUND", message: "Import job not found." });
        return;
      }
      res.json(job);
    } catch (error) {
      const response = errorResponse(error);
      res.status(response.status).json(response.body);
    }
  });

  router.patch("/:id/review", options.requireAdmin, async (req, res) => {
    try {
      res.json(await options.service.updateReview(userId(req), req.params.id, req.body));
    } catch (error) {
      const response = errorResponse(error);
      res.status(response.status).json(response.body);
    }
  });

  router.post("/:id/commit", options.requireAdmin, async (req, res) => {
    try {
      res.json(await options.service.commit(userId(req), req.params.id, req.body));
    } catch (error) {
      const response = errorResponse(error);
      res.status(response.status).json(response.body);
    }
  });

  const cancel = async (req: express.Request, res: express.Response): Promise<void> => {
    try {
      const cancelled = await options.service.cancel(userId(req), req.params.id);
      if (!cancelled) {
        res.status(404).json({ error: "CALENDAR_IMPORT_NOT_FOUND", message: "Import job not found or is no longer cancellable." });
        return;
      }
      res.status(204).send();
    } catch (error) {
      const response = errorResponse(error);
      res.status(response.status).json(response.body);
    }
  };
  router.post("/:id/cancel", options.requireAdmin, cancel);
  router.delete("/:id", options.requireAdmin, cancel);

  void options.service.recoverStaleJobs().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`[CalendarImport] stale-job recovery unavailable: ${message}`);
  });
  return router;
}