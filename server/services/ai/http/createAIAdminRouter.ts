import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { Router } from "express";
import type { AIInputService } from "../input/AIInputService.js";
import type { AIAdoptedBinaryFile, RawAIInput } from "../input/contracts.js";
import { AIInputService as DefaultAIInputService } from "../input/AIInputService.js";
import { AITemporaryFileManager } from "../input/temporaryFiles.js";
import { AIContentService } from "../AIContentService.js";
import { createConfiguredAIProvider } from "../providerFactory.js";
import { MCQAIEngine } from "../mcq/MCQAIEngine.js";
import type { MCQEnhancementOptions, MCQGenerationOptions, MCQOperationResult } from "../mcq/contracts.js";
import { FlashcardAIEngine } from "../flashcard/FlashcardAIEngine.js";
import type { FlashcardEnhancementOptions, FlashcardGenerationOptions, FlashcardOperationResult } from "../flashcard/contracts.js";
import { buildAIAdminResponse } from "./response.js";
import { AIHttpError, mapAIError, sendAIError } from "./errors.js";
import {
  parseMultipartOptions,
  parsePreviewRequest,
  type ParsedFlashcardPreviewRequest,
  type ParsedMCQPreviewRequest,
  type ParsedPreviewRequest,
} from "./requestSchemas.js";
import { createAIUploadMiddleware, type AIUploadMiddleware } from "./upload.js";
import {
  AI_HTTP_LIMITS,
} from "./limits.js";
import { AIAdminConcurrencyGate, AIAdminRateLimiter } from "./rateLimit.js";
import { AIPreviewJobManager } from "./previewJobs.js";

export interface AILectureResolver {
  findLecture(id: string): Promise<{ id: string; name: string } | null>;
}

export interface AIAdminEngines {
  mcq: Pick<MCQAIEngine, "extractExistingMCQs" | "generateMCQs" | "enhanceExistingMCQs">;
  flashcard: Pick<FlashcardAIEngine, "extractExistingFlashcards" | "generateFlashcards" | "enhanceExistingFlashcards">;
}

export interface AIAdminRouterOptions {
  requireAdmin: RequestHandler;
  lectureResolver: AILectureResolver;
  inputService?: AIInputService;
  temporaryFiles?: AITemporaryFileManager;
  engineFactory?: () => AIAdminEngines;
  rateLimiter?: AIAdminRateLimiter;
  concurrencyGate?: AIAdminConcurrencyGate;
  jobManager?: AIPreviewJobManager;
}

type UploadedFields = {
  file?: Express.Multer.File[];
  files?: Express.Multer.File[];
};

type AIRequest = Request & {
  aiRequestId?: string;
  aiAbort?: { signal: AbortSignal; cleanup(): void };
};

function requestId(req: Request): string {
  const current = (req as AIRequest).aiRequestId;
  if (current) return current;
  const created = randomUUID();
  (req as AIRequest).aiRequestId = created;
  return created;
}

function contentType(req: Request): string {
  return String(req.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
}

export function bindAIRequestAbort(req: Request, res: Response): { signal: AbortSignal; cleanup(): void } {
  const controller = new AbortController();
  let cleaned = false;
  const abort = (reason: string) => {
    if (!controller.signal.aborted) controller.abort(new Error(reason));
  };
  const onRequestAborted = () => abort("AI preview request upload was aborted.");
  const onResponseClose = () => {
    if (!res.writableEnded) abort("AI preview client disconnected.");
  };
  req.once("aborted", onRequestAborted);
  res.once("close", onResponseClose);
  return {
    signal: controller.signal,
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      req.removeListener("aborted", onRequestAborted);
      res.removeListener("close", onResponseClose);
    },
  };
}

function normalizeMultipartBody(req: Request): Record<string, unknown> {
  const body = req.body && typeof req.body === "object" ? { ...req.body } : {};
  if ("options" in body) body.options = parseMultipartOptions(body.options);
  return body;
}

async function adoptUploadedFile(
  manager: AITemporaryFileManager,
  file: Express.Multer.File,
): Promise<AIAdoptedBinaryFile> {
  const staged = await manager.adopt(file.path);
  return {
    sizeBytes: staged.sizeBytes,
    capability: staged.capability,
    dispose: staged.dispose,
  };
}

async function rawInputFromRequest(
  req: Request,
  parsed: ParsedPreviewRequest,
  manager: AITemporaryFileManager,
): Promise<RawAIInput> {
  if (parsed.inputKind === "text") {
    if (contentType(req) !== "application/json" && contentType(req) !== "") {
      throw new AIHttpError(400, "AI_INPUT_CONTRADICTION", "Pasted text must be submitted as JSON.");
    }
    return { kind: "text", text: parsed.text ?? "" };
  }

  const fields = (req.files ?? {}) as UploadedFields;
  const pdfs = fields.file ?? [];
  const images = fields.files ?? [];
  const adopted: AIAdoptedBinaryFile[] = [];
  try {
    if (parsed.inputKind === "pdf") {
      if (pdfs.length !== 1 || images.length > 0) {
        throw new AIHttpError(400, "AI_INPUT_CONTRADICTION", "PDF mode requires exactly one uploaded PDF.");
      }
      const file = pdfs[0]!;
      if (file.size > AI_HTTP_LIMITS.pdfBytes) {
        throw new AIHttpError(413, "AI_INPUT_TOO_LARGE", "The uploaded PDF exceeds the allowed size.");
      }
      const adoptedFile = await adoptUploadedFile(manager, file);
      adopted.push(adoptedFile);
      return {
        kind: "pdf",
        file: {
          adoptedFile,
          claimedMimeType: file.mimetype,
          originalFilename: file.originalname,
        },
      };
    }

    if (pdfs.length > 0 || images.length < 1 || images.length > AI_HTTP_LIMITS.imageCount) {
      throw new AIHttpError(400, "AI_INPUT_CONTRADICTION", "Image mode requires one to twenty uploaded images.");
    }
    const totalBytes = images.reduce((total, file) => total + file.size, 0);
    if (totalBytes > AI_HTTP_LIMITS.totalImageBytes) {
      throw new AIHttpError(413, "AI_IMAGE_BATCH_TOO_LARGE", "The total image request exceeds the allowed size.");
    }
    const files = [];
    for (const file of images) {
      if (file.size > AI_HTTP_LIMITS.imageBytes) {
        throw new AIHttpError(413, "AI_INPUT_TOO_LARGE", "An uploaded image exceeds the allowed size.");
      }
      const adoptedFile = await adoptUploadedFile(manager, file);
      adopted.push(adoptedFile);
      files.push({
        adoptedFile,
        claimedMimeType: file.mimetype,
        originalFilename: file.originalname,
      });
    }
    return { kind: "image", files };
  } catch (error) {
    await Promise.allSettled(adopted.map((file) => file.dispose()));
    throw error;
  }
}

function defaultEngineFactory(): AIAdminEngines {
  const contentService = new AIContentService(createConfiguredAIProvider());
  return {
    mcq: new MCQAIEngine(contentService),
    flashcard: new FlashcardAIEngine(contentService),
  };
}

function adminId(req: Request): string {
  const id = (req as { user?: { id?: unknown } }).user?.id;
  return typeof id === "string" && id.length > 0 ? id : "authenticated-admin";
}

async function dispatch(
  engines: AIAdminEngines,
  parsed: ParsedPreviewRequest,
  prepared: import("../input/contracts.js").PreparedAIInput,
  signal: AbortSignal,
): Promise<MCQOperationResult | FlashcardOperationResult> {
  if (parsed.target === "mcq") {
    const engine = engines.mcq;
    if (parsed.operation === "extract") return engine.extractExistingMCQs(
      prepared,
      signal,
      parsed.options as import("../mcq/contracts.js").MCQExtractOptions,
    );
    if (parsed.operation === "generate") {
      return engine.generateMCQs(prepared, parsed.options as MCQGenerationOptions, signal);
    }
    return engine.enhanceExistingMCQs(prepared, parsed.options as MCQEnhancementOptions, signal);
  }
  const engine = engines.flashcard;
  if (parsed.operation === "extract") return engine.extractExistingFlashcards(prepared, signal);
  if (parsed.operation === "generate") {
    return engine.generateFlashcards(prepared, parsed.options as FlashcardGenerationOptions, signal);
  }
  return engine.enhanceExistingFlashcards(prepared, parsed.options as FlashcardEnhancementOptions, signal);
}

function parsedRequest(
  target: "mcq" | "flashcard",
  req: Request,
): ParsedPreviewRequest {
  const body = contentType(req) === "multipart/form-data"
    ? normalizeMultipartBody(req)
    : req.body;
  return parsePreviewRequest(target, body);
}

export function createAIAdminRouter(options: AIAdminRouterOptions): Router {
  const router = Router();
  const temporaryFiles = options.temporaryFiles ?? new AITemporaryFileManager();
  const inputService = options.inputService ?? new DefaultAIInputService({}, temporaryFiles);
  const engineFactory = options.engineFactory ?? defaultEngineFactory;
  const rateLimiter = options.rateLimiter ?? new AIAdminRateLimiter();
  const concurrencyGate = options.concurrencyGate ?? new AIAdminConcurrencyGate();
  const jobManager = options.jobManager ?? new AIPreviewJobManager();
  const upload = createAIUploadMiddleware(temporaryFiles) as AIUploadMiddleware;

  router.use((req, res, next) => {
    (req as AIRequest).aiRequestId = randomUUID();
    (req as AIRequest).aiAbort = bindAIRequestAbort(req, res);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    next();
  });

  const multipartParser: RequestHandler = (req, res, next) => {
    if (contentType(req) !== "multipart/form-data") return next();
    upload(req, res, next);
  };

  const handlePreview = (target: "mcq" | "flashcard") => async (req: Request, res: Response) => {
    const id = requestId(req);
    const startedAt = performance.now();
    const abort = (req as AIRequest).aiAbort ?? bindAIRequestAbort(req, res);
    let lease: { release(): void } | null = null;
    const adoptedCleanup: AIAdoptedBinaryFile[] = [];
    let responseBody: ReturnType<typeof buildAIAdminResponse> | undefined;
    let caughtError: unknown;
    let failed = false;
    try {
      const parsed = parsedRequest(target, req);
      const admission = rateLimiter.check(adminId(req));
      if (!admission.allowed) {
        throw new AIHttpError(
          429,
          "APP_AI_RATE_LIMIT",
          "AI preview request limit reached. Please try again later.",
          true,
          { field: String(admission.retryAfterSeconds) },
        );
      }
      lease = concurrencyGate.tryAcquire(adminId(req));
      if (!lease) {
        throw new AIHttpError(409, "AI_OPERATION_IN_PROGRESS", "An AI preview is already in progress for this administrator.");
      }

      const lecture = await options.lectureResolver.findLecture(parsed.lectureId);
      if (!lecture) {
        throw new AIHttpError(404, "LECTURE_NOT_FOUND", "The selected lecture was not found.");
      }

      const rawInput = await rawInputFromRequest(req, parsed, temporaryFiles);
      if (rawInput.kind === "pdf") adoptedCleanup.push(rawInput.file.adoptedFile!);
      if (rawInput.kind === "image") adoptedCleanup.push(...rawInput.files.map((file) => file.adoptedFile!));

      const result = await inputService.withPreparedInput(
        rawInput,
        (prepared) => dispatch(engineFactory(), parsed, prepared, abort.signal),
      );
      responseBody = buildAIAdminResponse(id, target, lecture, parsed.inputKind, result);
      console.info(JSON.stringify({
        category: "AI_PREVIEW",
        requestId: id,
        adminId: adminId(req),
        target,
        operation: parsed.operation,
        inputKind: parsed.inputKind,
        returnedCount: result.items.length,
        durationMs: Math.max(0, performance.now() - startedAt),
      }));
    } catch (error) {
      failed = true;
      caughtError = error;
    } finally {
      abort.cleanup();
      lease?.release();
      await Promise.allSettled(adoptedCleanup.map((file) => file.dispose()));
    }
    if (failed) return sendAIError(res, id, caughtError);
    return res.status(200).json(responseBody);
  };

  const handlePreviewJob = (target: "mcq" | "flashcard") => async (req: Request, res: Response) => {
    const id = requestId(req);
    const startedAt = performance.now();
    let lease: { release(): void } | null = null;
    let rawInput: RawAIInput | undefined;
    let enqueued = false;
    try {
      const parsed = parsedRequest(target, req);
      const owner = adminId(req);
      const admission = rateLimiter.check(owner);
      if (!admission.allowed) {
        throw new AIHttpError(
          429,
          "APP_AI_RATE_LIMIT",
          "AI preview request limit reached. Please try again later.",
          true,
          { field: String(admission.retryAfterSeconds) },
        );
      }
      lease = concurrencyGate.tryAcquire(owner);
      if (!lease) {
        throw new AIHttpError(409, "AI_OPERATION_IN_PROGRESS", "An AI preview is already in progress for this administrator.");
      }
      const lecture = await options.lectureResolver.findLecture(parsed.lectureId);
      if (!lecture) throw new AIHttpError(404, "LECTURE_NOT_FOUND", "The selected lecture was not found.");
      rawInput = await rawInputFromRequest(req, parsed, temporaryFiles);
      const acquiredLease = lease;
      const job = jobManager.create({
        ownerId: owner,
        target,
        operation: parsed.operation,
        inputKind: parsed.inputKind,
        lecture,
        requestId: id,
        rawInput,
        inputService,
        engineFactory,
        releaseLease: () => acquiredLease?.release(),
        options: parsed.options,
        dispatch: (engines, jobParsed, prepared, signal) => dispatch(
          engines,
          { ...parsed, options: jobParsed.options } as ParsedPreviewRequest,
          prepared,
          signal,
        ),
        buildResponse: (requestIdValue, targetValue, lectureValue, inputKindValue, result) =>
          buildAIAdminResponse(requestIdValue, targetValue, lectureValue, inputKindValue, result),
      });
      enqueued = true;
      rawInput = undefined;
      lease = null;
      console.info(JSON.stringify({
        category: "AI_PREVIEW_JOB",
        requestId: id,
        jobId: job.jobId,
        adminId: owner,
        target,
        operation: parsed.operation,
        inputKind: parsed.inputKind,
        durationMs: Math.max(0, performance.now() - startedAt),
      }));
      return res.status(202).json({
        requestId: id,
        jobId: job.jobId,
        state: job.state,
        target: job.target,
        operation: job.operation,
        inputKind: job.inputKind,
        progress: job.progress,
      });
    } catch (error) {
      return sendAIError(res, id, error);
    } finally {
      if (!enqueued && rawInput) {
        const adopted = rawInput.kind === "pdf"
          ? [rawInput.file.adoptedFile]
          : rawInput.kind === "image"
            ? rawInput.files.map((file) => file.adoptedFile)
            : [];
        await Promise.allSettled(adopted.filter(Boolean).map((file) => file!.dispose()));
      }
      lease?.release();
    }
  };

  const getPreviewJob = (req: Request, res: Response) => {
    const job = jobManager.get(String(req.params.jobId), adminId(req));
    if (!job) return res.status(404).json({
      requestId: requestId(req),
      error: { code: "AI_JOB_NOT_FOUND", message: "The AI preview job was not found." },
    });
    return res.status(200).json(job);
  };

  const cancelPreviewJob = (req: Request, res: Response) => {
    const job = jobManager.cancel(String(req.params.jobId), adminId(req));
    if (!job) return res.status(404).json({
      requestId: requestId(req),
      error: { code: "AI_JOB_NOT_FOUND", message: "The AI preview job was not found." },
    });
    return res.status(200).json(job);
  };

  router.post(
    "/mcq/preview",
    options.requireAdmin,
    multipartParser,
    (req, res, next) => { void handlePreview("mcq")(req, res).catch(next); },
  );
  router.post(
    "/mcq/preview-jobs",
    options.requireAdmin,
    multipartParser,
    (req, res, next) => { void handlePreviewJob("mcq")(req, res).catch(next); },
  );
  router.get("/mcq/preview-jobs/:jobId", options.requireAdmin, getPreviewJob);
  router.delete("/mcq/preview-jobs/:jobId", options.requireAdmin, cancelPreviewJob);
  router.post(
    "/flashcards/preview-jobs",
    options.requireAdmin,
    multipartParser,
    (req, res, next) => { void handlePreviewJob("flashcard")(req, res).catch(next); },
  );
  router.get("/flashcards/preview-jobs/:jobId", options.requireAdmin, getPreviewJob);
  router.delete("/flashcards/preview-jobs/:jobId", options.requireAdmin, cancelPreviewJob);
  router.post(
    "/flashcards/preview",
    options.requireAdmin,
    multipartParser,
    (req, res, next) => { void handlePreview("flashcard")(req, res).catch(next); },
  );

  router.use(async (error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    await upload.cleanup(req);
    (req as AIRequest).aiAbort?.cleanup();
    sendAIError(res, requestId(req), mapAIError(error));
  });
  return router;
}