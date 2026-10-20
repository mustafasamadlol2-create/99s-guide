import express, { type RequestHandler } from "express";
import multer from "multer";
import type { PrismaClient } from "@prisma/client";
import { FocusSoundService } from "../features/focus-sounds/service.js";
import { MAX_FOCUS_SOUND_BYTES } from "../features/focus-sounds/storage.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FOCUS_SOUND_BYTES, files: 1, fields: 4, parts: 6 },
});

const uploadSingle: RequestHandler = (req, res, next) => {
  upload.single("file")(req, res, (error: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Focus sound file is too large.", code: "FOCUS_SOUND_INVALID_SIZE" });
    }
    return res.status(400).json({ error: "Focus sound upload is invalid.", code: "FOCUS_SOUND_UPLOAD_INVALID" });
  });
};

function errorResponse(res: express.Response, error: unknown): express.Response {
  const message = error instanceof Error ? error.message : "";
  if (message === "FOCUS_SOUND_UNSUPPORTED_AUDIO" || message === "FOCUS_SOUND_SIGNATURE_MISMATCH") {
    return res.status(415).json({ error: "Unsupported or invalid audio file.", code: message });
  }
  if (message === "FOCUS_SOUND_INVALID_SIZE") {
    return res.status(413).json({ error: "Focus sound file is too large.", code: message });
  }
  if (message.startsWith("FOCUS_SOUND_INVALID_") || message === "FOCUS_SOUND_EMPTY_UPDATE") {
    return res.status(400).json({ error: "Focus sound request is invalid.", code: message });
  }
  const prismaCode = (error as { code?: unknown } | null)?.code;
  if (prismaCode === "P2025") return res.status(404).json({ error: "Focus sound not found.", code: "FOCUS_SOUND_NOT_FOUND" });
  console.error("[FocusSounds] request failed", error);
  return res.status(503).json({ error: "Focus Sounds are temporarily unavailable.", code: "FOCUS_SOUNDS_UNAVAILABLE" });
}

export function createFocusSoundsRouter(dependencies: {
  requireUser: RequestHandler;
  database: PrismaClient;
}): express.Router {
  const router = express.Router();
  const service = new FocusSoundService(dependencies.database);
  router.use(dependencies.requireUser);
  router.get("/", async (_req, res) => {
    try {
      const sounds = await service.listEnabled();
      res.set("Cache-Control", "private, max-age=60, stale-while-revalidate=120");
      return res.json({ sounds });
    } catch (error) {
      return errorResponse(res, error);
    }
  });
  return router;
}

export function createOwnerFocusSoundsRouter(dependencies: {
  requireOwner: RequestHandler;
  database: PrismaClient;
}): express.Router {
  const router = express.Router();
  const service = new FocusSoundService(dependencies.database);
  router.use(dependencies.requireOwner);

  router.get("/", async (_req, res) => {
    try {
      res.set("Cache-Control", "private, no-store");
      return res.json({ sounds: await service.listAll() });
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  router.post("/", uploadSingle, async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "Audio file is required.", code: "FOCUS_SOUND_FILE_REQUIRED" });
      const userId = String((req as express.Request & { user?: { id?: string } }).user?.id ?? "");
      if (!userId) return res.status(401).json({ error: "Authentication required." });
      const sound = await service.create({
        createdById: userId,
        name: req.body?.name,
        file: {
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
          buffer: req.file.buffer,
        },
      });
      return res.status(201).json({ sound });
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  router.patch("/:id", express.json({ limit: "4kb" }), async (req, res) => {
    try {
      const sound = await service.update(req.params.id, {
        name: req.body?.name,
        isEnabled: req.body?.isEnabled,
        sortOrder: req.body?.sortOrder,
      });
      return res.json({ sound });
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  router.post("/reorder", express.json({ limit: "16kb" }), async (req, res) => {
    try {
      await service.reorder(req.body?.ids);
      return res.json({ ok: true });
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      await service.remove(req.params.id);
      return res.status(204).send();
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  return router;
}
