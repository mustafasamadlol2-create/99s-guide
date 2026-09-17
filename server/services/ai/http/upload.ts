import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import multer from "multer";
import type { RequestHandler } from "express";
import type { AITemporaryFileManager } from "../input/temporaryFiles.js";
import { AI_HTTP_LIMITS } from "./limits.js";

export function createAIUploadMiddleware(manager: AITemporaryFileManager): RequestHandler {
  const trackedPaths = new WeakMap<object, Set<string>>();
  const storage = multer.diskStorage({
    destination: async (_req, _file, callback) => {
      try {
        await mkdir(manager.root, { recursive: true, mode: 0o700 });
        callback(null, manager.root);
      } catch (error) {
        callback(error as Error, manager.root);
      }
    },
    filename: (req, _file, callback) => {
      const filename = randomUUID();
      const paths = trackedPaths.get(req) ?? new Set<string>();
      paths.add(join(manager.root, filename));
      trackedPaths.set(req, paths);
      callback(null, filename);
    },
  });
  const upload = multer({
    storage,
    limits: {
      fileSize: AI_HTTP_LIMITS.pdfBytes,
      files: AI_HTTP_LIMITS.imageCount,
      fields: 6,
      fieldSize: AI_HTTP_LIMITS.optionsBytes,
      parts: AI_HTTP_LIMITS.imageCount + 6,
    },
  }).fields([
    { name: "file", maxCount: 1 },
    { name: "files", maxCount: AI_HTTP_LIMITS.imageCount },
  ]);
  const middleware = ((req, res, next) => upload(req, res, next)) as RequestHandler & {
    cleanup(req: Express.Request): Promise<void>;
  };
  middleware.cleanup = async (req) => {
    const paths = trackedPaths.get(req);
    if (!paths) return;
    trackedPaths.delete(req);
    await Promise.allSettled([...paths].map(async (path) => {
      try {
        const staged = await manager.adopt(path);
        await staged.dispose();
      } catch {
        // Multer may have removed a partial file itself.
      }
    }));
  };
  return middleware;
}

export type AIUploadMiddleware = RequestHandler & { cleanup(req: Express.Request): Promise<void> };