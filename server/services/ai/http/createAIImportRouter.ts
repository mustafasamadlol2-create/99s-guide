import { randomUUID } from "node:crypto";
import type { RequestHandler, Request, Response } from "express";
import { Router } from "express";
import { AIImportService, mapImportError } from "../import/service.js";
import { parseFlashcardImportRequest, parseMCQImportRequest } from "../import/schemas.js";

export interface AIImportRouterOptions {
  requireAdmin: RequestHandler;
  service: AIImportService;
}

function sendImportError(res: Response, requestId: string, error: unknown): void {
  const mapped = mapImportError(error);
  res.status(mapped.status).json({
    requestId,
    error: {
      code: mapped.code,
      message: mapped.message,
      ...(mapped.details ? { details: mapped.details } : {}),
    },
  });
}

export function createAIImportRouter(options: AIImportRouterOptions): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    next();
  });

  const handle = (target: "mcq" | "flashcard", mode: "check" | "commit") =>
    async (req: Request, res: Response): Promise<void> => {
      const requestId = randomUUID();
      try {
        if (target === "mcq") {
          const parsed = parseMCQImportRequest(req.body);
          const result = mode === "check"
            ? await options.service.check(target, parsed.lectureId, parsed.candidates, requestId)
            : await options.service.commit(target, parsed.lectureId, parsed.candidates, requestId);
          res.status(200).json(result);
          return;
        }
        const parsed = parseFlashcardImportRequest(req.body);
        const result = mode === "check"
          ? await options.service.check(target, parsed.lectureId, parsed.candidates, requestId)
          : await options.service.commit(target, parsed.lectureId, parsed.candidates, requestId);
        res.status(200).json(result);
      } catch (error) {
        sendImportError(res, requestId, error);
      }
    };

  router.post("/mcq/import/check", options.requireAdmin, (req, res, next) => {
    void handle("mcq", "check")(req, res).catch(next);
  });
  router.post("/mcq/import", options.requireAdmin, (req, res, next) => {
    void handle("mcq", "commit")(req, res).catch(next);
  });
  router.post("/flashcards/import/check", options.requireAdmin, (req, res, next) => {
    void handle("flashcard", "check")(req, res).catch(next);
  });
  router.post("/flashcards/import", options.requireAdmin, (req, res, next) => {
    void handle("flashcard", "commit")(req, res).catch(next);
  });
  return router;
}