import express, { type RequestHandler } from "express";
import multer from "multer";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { AIServiceError } from "../ai/errors.js";
import { CalendarImportService } from "./service.js";

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function errorResponse(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof AIServiceError) {
    return { status: 400, body: { error: error.code, message: error.publicMessage } };
  }
  const message = error instanceof Error ? error.message : "Calendar import request failed.";
  return { status: 400, body: { error: "CALENDAR_IMPORT_INVALID", message } };
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
  const upload = multer({
    dest: options.sourceRoot,
    limits: { files: 20, fileSize: 100 * 1024 * 1024, fieldSize: 32 * 1024 },
    fileFilter: (_req, file, callback) => {
      callback(null, ALLOWED_MIMES.has(file.mimetype));
    },
  });

  router.post("/", options.requireAdmin, upload.array("files", 20), async (req, res) => {
    const files = (req.files ?? []) as Express.Multer.File[];
    try {
      if (files.length === 0) {
        res.status(400).json({ error: "CALENDAR_IMPORT_NO_FILES", message: "Upload at least one schedule file." });
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
      );
      res.status(202).json(job);
    } catch (error) {
      await Promise.all(files.map((file) => import("node:fs/promises").then(({ unlink }) => unlink(file.path).catch(() => {}))));
      const response = errorResponse(error);
      res.status(response.status).json(response.body);
    }
  });

  router.get("/:id", options.requireAdmin, async (req, res) => {
    const job = await options.service.get(userId(req), req.params.id);
    if (!job) {
      res.status(404).json({ error: "CALENDAR_IMPORT_NOT_FOUND", message: "Import job not found." });
      return;
    }
    res.json(job);
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
    const cancelled = await options.service.cancel(userId(req), req.params.id);
    if (!cancelled) {
      res.status(404).json({ error: "CALENDAR_IMPORT_NOT_FOUND", message: "Import job not found or is no longer cancellable." });
      return;
    }
    res.status(204).send();
  };
  router.post("/:id/cancel", options.requireAdmin, cancel);
  router.delete("/:id", options.requireAdmin, cancel);

  void mkdir(join(options.sourceRoot), { recursive: true });
  void options.service.recoverStaleJobs().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`[CalendarImport] stale-job recovery unavailable: ${message}`);
  });
  return router;
}