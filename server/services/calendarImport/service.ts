import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { AIServiceError } from "../ai/errors.js";
import { createConfiguredAIProvider } from "../ai/providerFactory.js";
import type { AIProvider } from "../ai/contracts.js";
import { AIInputService } from "../ai/input/AIInputService.js";
import { AITemporaryFileManager } from "../ai/input/temporaryFiles.js";
import {
  calendarCandidateSchema,
  calendarImportPreviewSchema,
  commitRequestSchema,
  type CalendarCandidate,
  type CommitRequest,
  type CalendarImportPreview,
  type ExtractionCandidate,
  type ReviewUpdate,
  reviewUpdateSchema,
} from "./schemas.js";
import { getPdfPageCount } from "./pdf.js";
import { extractSchedule, verifySchedule } from "./extraction.js";
import { isCalendarTargetGroup } from "../../../shared/calendarContracts.js";
import {
  applyVerification,
  candidateDateTime,
  normalizeCandidate,
  type NormalizedCalendarCandidate,
} from "./normalize.js";
import {
  compareCandidateToEvents,
  computeFingerprint,
  markDuplicateAndConflict,
  markWithinImportConflicts,
  markWithinImportDuplicates,
  type ExistingCalendarEvent,
} from "./duplicateDetection.js";

const MAX_STORED_SOURCE_BYTES = 100 * 1024 * 1024;
const STALE_JOB_MS = 12 * 60 * 1000;

export interface CalendarImportUpload {
  path: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface CalendarImportServiceOptions {
  prisma: PrismaClient;
  sourceRoot: string;
  providerFactory?: () => AIProvider;
  onCalendarUpsert?: (events: Array<Record<string, unknown>>) => Promise<void> | void;
}

export interface CommitResult {
  inserted: number;
  alreadyImported: number;
  duplicatesSkipped: number;
  conflictsSkipped: number;
  invalidRejected: number;
  events: Array<Record<string, unknown>>;
}

function safeJson<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

function sourceHash(bytes: Uint8Array[]): string {
  const hash = createHash("sha256");
  for (const item of bytes) hash.update(item);
  return hash.digest("hex");
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif", "avif", "tif", "tiff", "bmp", "gif"]);

function extensionOf(value: string): string {
  const clean = value.replaceAll("\\", "/").split("/").pop()?.toLowerCase() ?? "";
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1) : "";
}

function isPdfUpload(upload: CalendarImportUpload): boolean {
  const mime = upload.mimeType.trim().toLowerCase();
  return mime === "application/pdf" ||
    ((mime === "application/octet-stream" || !mime) && extensionOf(upload.originalName) === "pdf");
}

function isImageUpload(upload: CalendarImportUpload): boolean {
  const mime = upload.mimeType.trim().toLowerCase();
  return mime.startsWith("image/") ||
    ((mime === "application/octet-stream" || !mime) && IMAGE_EXTENSIONS.has(extensionOf(upload.originalName)));
}

function imageSourceMetadata(value: string): Array<{ mimeType: string; originalName?: string }> {
  const parsed = safeJson<unknown>(value, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item) => {
    if (typeof item === "string") return { mimeType: item };
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      return {
        mimeType: typeof record.mimeType === "string" ? record.mimeType : "application/octet-stream",
        ...(typeof record.originalName === "string" ? { originalName: record.originalName } : {}),
      };
    }
    return { mimeType: "application/octet-stream" };
  });
}

function publicJob(job: {
  id: string;
  status: string;
  stage: string;
  sourceFileName: string;
  sourceMime: string;
  sourcePageCount: number | null;
  timezone: string;
  defaultTargetGroups: string;
  progressCurrent: number;
  progressTotal: number;
  previewData: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}): Record<string, unknown> {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    sourceFileName: job.sourceFileName,
    sourceMime: job.sourceMime.startsWith("[") ? "image/*" : job.sourceMime,
    sourcePageCount: job.sourcePageCount,
    timezone: job.timezone,
    defaultTargetGroups: job.defaultTargetGroups.split(",").filter(Boolean),
    progressCurrent: job.progressCurrent,
    progressTotal: job.progressTotal,
    preview: job.previewData ?? null,
    error: job.errorCode ? { code: job.errorCode, message: job.errorMessage } : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  };
}

export class CalendarImportService {
  private readonly providerFactory: () => AIProvider;
  private readonly root: string;
  private readonly activeControllers = new Map<string, AbortController>();

  constructor(private readonly options: CalendarImportServiceOptions) {
    this.providerFactory = options.providerFactory ?? createConfiguredAIProvider;
    this.root = resolve(options.sourceRoot);
  }

  private ownsSource(path: string): boolean {
    const rel = relative(this.root, resolve(path));
    return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  }

  private async cleanupSources(paths: string[]): Promise<void> {
    await Promise.allSettled(paths.filter((path) => this.ownsSource(path)).map(async (path) => {
      await unlink(path).catch(() => {});
    }));
  }

  private async validateUploads(
    uploads: CalendarImportUpload[],
  ): Promise<{ sourceHash: string; inputKind: "pdf" | "image" }> {
    if (uploads.length === 0 || uploads.length > 20) {
      throw new AIServiceError("AI_INPUT_INVALID", {
        publicMessage: "Upload one PDF or one to twenty schedule images.",
        diagnosticMessage: "Calendar schedule import received an unsupported file count.",
      });
    }
    const bytes = await Promise.all(uploads.map((upload) => readFile(upload.path)));
    const totalBytes = bytes.reduce((sum, item) => sum + item.byteLength, 0);
    if (totalBytes > MAX_STORED_SOURCE_BYTES) {
      throw new AIServiceError("AI_INPUT_TOO_LARGE", {
        publicMessage: "The schedule files exceed the allowed size.",
        diagnosticMessage: "Calendar import source exceeded 100 MiB.",
      });
    }
    const isPdf = uploads.length === 1 && isPdfUpload(uploads[0]!);
    const isImages = uploads.every(isImageUpload);
    if (!isPdf && !isImages) {
      throw new AIServiceError("AI_INPUT_UNSUPPORTED", {
        publicMessage: "Upload one PDF or supported schedule images.",
        diagnosticMessage: "Calendar import requires one PDF or image-only input.",
      });
    }
    const inputService = new AIInputService({}, new AITemporaryFileManager(join(this.root, "validated")));
    if (isPdf) {
      await inputService.withPreparedInput({
        kind: "pdf",
        file: {
          bytes: new Uint8Array(bytes[0]!),
          claimedMimeType: uploads[0]!.mimeType || "application/octet-stream",
          originalFilename: uploads[0]!.originalName,
        },
      }, async () => {});
    } else {
      await inputService.withPreparedInput({
        kind: "image",
        files: uploads.map((upload, index) => ({
          bytes: new Uint8Array(bytes[index]!),
          claimedMimeType: upload.mimeType || "application/octet-stream",
          originalFilename: upload.originalName,
          sourceLabel: `schedule image ${index + 1}`,
        })),
      }, async () => {});
    }
    return { sourceHash: sourceHash(bytes.map((item) => new Uint8Array(item))), inputKind: isPdf ? "pdf" : "image" };
  }

  async start(
    userId: string,
    uploads: CalendarImportUpload[],
    defaultTargetGroups: string[],
    pastedText?: string,
  ): Promise<Record<string, unknown>> {
    const hasText = typeof pastedText === "string" && pastedText.trim().length > 0;
    if (hasText && uploads.length > 0) {
      throw new AIServiceError("AI_INPUT_INVALID", {
        publicMessage: "Choose either pasted schedule text or uploaded files, not both.",
        diagnosticMessage: "Calendar import received text and binary sources in the same job.",
      });
    }

    const targetGroups = [...new Set(defaultTargetGroups.map((group) => group.trim().toUpperCase()).filter(Boolean))];
    if (targetGroups.length === 0 || targetGroups.some((group) => !isCalendarTargetGroup(group))) {
      throw new AIServiceError("AI_VALIDATION_ERROR", {
        publicMessage: "Select a valid default audience for schedule events.",
        diagnosticMessage: "Calendar import default target groups were invalid.",
      });
    }

    let inputKind: "pdf" | "image" | "text";
    let sourceSha256: string;
    let sourceFileName: string;
    let sourceMime: string;
    let sourcePaths: string[];

    if (hasText) {
      const inputService = new AIInputService();
      const prepared = await inputService.prepare({ kind: "text", text: pastedText!, sourceLabel: "pasted schedule text" });
      try {
        const normalizedText = prepared.input.kind === "text" ? prepared.input.text.text : pastedText!.trim();
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        const textPath = join(this.root, `${randomUUID()}.txt`);
        await writeFile(textPath, normalizedText, { flag: "wx", mode: 0o600 });
        inputKind = "text";
        sourceSha256 = prepared.input.kind === "text" ? prepared.input.text.sha256 : createHash("sha256").update(normalizedText).digest("hex");
        sourceFileName = "Pasted schedule text";
        sourceMime = "text/plain";
        sourcePaths = [textPath];
      } finally {
        await prepared.dispose();
      }
    } else {
      const validation = await this.validateUploads(uploads);
      inputKind = validation.inputKind;
      sourceSha256 = validation.sourceHash;
      sourceFileName = uploads.length === 1 ? uploads[0]!.originalName : `${uploads.length} schedule images`;
      sourceMime = inputKind === "pdf"
        ? "application/pdf"
        : JSON.stringify(uploads.map((upload) => ({ mimeType: upload.mimeType, originalName: upload.originalName })));
      sourcePaths = uploads.map((upload) => upload.path);
    }

    try {
      const job = await this.options.prisma.calendarImportJob.create({
        data: {
          userId,
          status: "UPLOADED",
          stage: "Uploading",
          sourceFileName,
          sourceMime,
          sourceSha256,
          sourcePath: JSON.stringify(sourcePaths),
          defaultTargetGroups: targetGroups.includes("ALL") ? "ALL" : targetGroups.join(","),
        },
      });
      void this.process(job.id).catch(() => {});
      return publicJob(job);
    } catch (error) {
      if (inputKind === "text") await this.cleanupSources(sourcePaths);
      throw error;
    }
  }

  async recoverStaleJobs(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_JOB_MS);
    const stale = await this.options.prisma.calendarImportJob.findMany({
      where: {
        status: "PROCESSING",
        updatedAt: { lt: cutoff },
      },
      select: { id: true, sourcePath: true },
    });
    await this.options.prisma.calendarImportJob.updateMany({
      where: {
        status: "PROCESSING",
        updatedAt: { lt: cutoff },
      },
      data: {
        status: "FAILED",
        stage: "Preparing source",
        errorCode: "AI_IMPORT_INTERRUPTED",
        errorMessage: "Schedule extraction was interrupted. Please retry the import.",
        sourcePath: null,
      },
    });
    await Promise.all(stale.map((job) => this.cleanupSources(safeJson<string[]>(job.sourcePath, []))));

    // A process can terminate after the DB row is created but before the worker claims it.
    // Reclaim queued jobs on startup; the atomic status transition in process() prevents duplicates.
    const queued = await this.options.prisma.calendarImportJob.findMany({
      where: { status: "UPLOADED" },
      select: { id: true },
    });
    for (const job of queued) void this.process(job.id).catch(() => {});
  }

  private async prepareContents(job: {
    sourcePath: string | null;
    sourceMime: string;
    sourceFileName: string;
  }): Promise<{
    contents: import("../ai/input/contracts.js").AIContentPart[];
    dispose: () => Promise<void>;
    inputKind: "pdf" | "image" | "text";
  }> {
    const paths = safeJson<string[]>(job.sourcePath, []);
    if (paths.length === 0 || paths.some((path) => !this.ownsSource(path))) {
      throw new AIServiceError("AI_INPUT_INVALID", {
        publicMessage: "The temporary schedule source is no longer available.",
        diagnosticMessage: "Calendar import source path failed ownership validation.",
      });
    }
    const bytes = await Promise.all(paths.map((path) => readFile(path)));
    const manager = new AITemporaryFileManager(join(this.root, "worker"));
    const inputService = new AIInputService({}, manager);
    if (job.sourceMime === "text/plain") {
      const prepared = await inputService.prepare({
        kind: "text",
        text: Buffer.from(bytes[0]!).toString("utf8"),
        sourceLabel: job.sourceFileName,
      });
      return { contents: prepared.contents, dispose: prepared.dispose, inputKind: "text" };
    }
    if (job.sourceMime === "application/pdf") {
      const prepared = await inputService.prepare({
        kind: "pdf",
        file: {
          bytes: new Uint8Array(bytes[0]!),
          claimedMimeType: "application/pdf",
          originalFilename: job.sourceFileName,
        },
      });
      return { contents: prepared.contents, dispose: prepared.dispose, inputKind: "pdf" };
    }
    const metadata = imageSourceMetadata(job.sourceMime);
    const prepared = await inputService.prepare({
      kind: "image",
      files: paths.map((path, index) => ({
        bytes: new Uint8Array(bytes[index]!),
        claimedMimeType: metadata[index]?.mimeType ?? "application/octet-stream",
        originalFilename: metadata[index]?.originalName ?? path.split(sep).pop() ?? `schedule-${index + 1}`,
        sourceLabel: `schedule image ${index + 1}`,
      })),
    });
    return { contents: prepared.contents, dispose: prepared.dispose, inputKind: "image" };
  }

  async process(id: string): Promise<void> {
    const claimed = await this.options.prisma.calendarImportJob.updateMany({
      where: { id, status: { in: ["UPLOADED", "FAILED"] } },
      data: { status: "PROCESSING", stage: "Preparing source", errorCode: null, errorMessage: null },
    });
    if (claimed.count === 0) return;
    const job = await this.options.prisma.calendarImportJob.findUnique({ where: { id } });
    if (!job || job.status === "CANCELLED") return;
    let paths: string[] = safeJson(job.sourcePath, []);
    let disposePrepared: (() => Promise<void>) | null = null;
    let provider: AIProvider | null = null;
    const controller = new AbortController();
    this.activeControllers.set(id, controller);
    try {
      const prepared = await this.prepareContents(job);
      disposePrepared = prepared.dispose;
      const pageCount = job.sourceMime === "application/pdf" ? await getPdfPageCount(paths[0]!) : null;
      const finalized = await this.options.prisma.calendarImportJob.updateMany({
        where: { id, status: "PROCESSING" },
        data: {
          sourcePageCount: pageCount,
          stage: "Extracting schedule",
          progressCurrent: 0,
          progressTotal: pageCount ?? prepared.contents.length,
        },
      });
      if (finalized.count === 0) {
        await prepared.dispose();
        await this.cleanupSources(paths);
        return;
      }
      provider = this.providerFactory();
      const extracted = await extractSchedule({
        provider,
        contents: prepared.contents,
        sourcePageCount: pageCount,
        inputKind: prepared.inputKind,
        signal: controller.signal,
        onProgress: async (current, total) => {
          await this.options.prisma.calendarImportJob.updateMany({
            where: { id, status: "PROCESSING" },
            data: { stage: "Extracting schedule", progressCurrent: current, progressTotal: total },
          });
        },
      });
      await this.options.prisma.calendarImportJob.update({ where: { id }, data: { stage: "Validating dates and times" } });
      const defaultGroups = job.defaultTargetGroups.split(",").filter(Boolean);
      let normalized: NormalizedCalendarCandidate[] = extracted.candidates.map((candidate, index) =>
        normalizeCandidate(candidate, `${id}-${index + 1}`, {
          defaultTargetGroups: defaultGroups,
          sourcePageCount: pageCount,
          sourceImageCount: prepared.inputKind === "image" ? prepared.contents.length : 0,
          allowTextSource: prepared.inputKind === "text",
        }),
      );
      await this.options.prisma.calendarImportJob.updateMany({
        where: { id, status: "PROCESSING" },
        data: { stage: "Verifying against source", progressCurrent: 0, progressTotal: normalized.length },
      });
      const verification = await verifySchedule(
        provider,
        prepared.contents,
        normalized.map((item) => ({ candidateId: item.candidate.candidateId, candidate: item.candidate })),
        {
          signal: controller.signal,
          onProgress: async (current, total) => {
            await this.options.prisma.calendarImportJob.updateMany({
              where: { id, status: "PROCESSING" },
              data: { stage: "Verifying against source", progressCurrent: current, progressTotal: total },
            });
          },
        },
      );
      const verificationMap = new Map(verification.items.map((item) => [item.candidateId, item]));
      normalized = normalized.map((item) => applyVerification(
        item,
        verificationMap.get(item.candidate.candidateId) ?? {
          status: "NOT_FOUND",
          issues: ["Candidate was not returned by the source verifier."],
        },
      ));
      await this.options.prisma.calendarImportJob.update({ where: { id }, data: { stage: "Checking Calendar conflicts" } });
      const candidates = markWithinImportConflicts(
        markWithinImportDuplicates(normalized.map((item) => item.candidate)),
      );
      const dates = normalized.flatMap((item) => {
        const value = candidateDateTime(item.candidate);
        return value ? [value.startDateTime, value.endDateTime] : [];
      });
      const existing = await this.options.prisma.calendarEvent.findMany({
        where: dates.length > 0 ? {
          startDateTime: { lt: new Date(Math.max(...dates.map((date) => date.getTime()))) },
          endDateTime: { gt: new Date(Math.min(...dates.map((date) => date.getTime()))) },
        } : { id: "__no_events__" },
      });
      const existingEvents: ExistingCalendarEvent[] = existing.map((event) => ({
        id: event.id,
        title: event.title,
        eventType: event.eventType,
        startDateTime: event.startDateTime,
        endDateTime: event.endDateTime,
        targetGroups: event.targetGroups,
        subjectId: event.subjectId,
        importFingerprint: event.importFingerprint,
      }));
      const reviewed = candidates.map((candidate) =>
        markDuplicateAndConflict(candidate, compareCandidateToEvents(candidate, existingEvents)),
      );
      const preview: CalendarImportPreview = calendarImportPreviewSchema.parse({
        candidates: reviewed,
        warnings: [...new Set([...extracted.warnings, ...verification.warnings])].slice(0, 50),
        provider: extracted.provider,
      });
      const ready = await this.options.prisma.calendarImportJob.updateMany({
        where: { id, status: "PROCESSING" },
        data: {
          status: "READY_FOR_REVIEW",
          stage: "Ready for review",
          progressCurrent: preview.candidates.length,
          progressTotal: preview.candidates.length,
          previewData: preview,
          sourcePath: null,
        },
      });
      if (ready.count === 0) {
        await prepared.dispose();
        await this.cleanupSources(paths);
        await this.options.prisma.calendarImportJob.updateMany({
          where: { id },
          data: { sourcePath: null },
        });
        return;
      }
      await prepared.dispose();
      disposePrepared = null;
      await this.cleanupSources(paths);
      paths = [];
    } catch (error) {
      const publicMessage = error instanceof AIServiceError
        ? error.publicMessage
        : "The schedule could not be extracted. Please try again.";
      const current = await this.options.prisma.calendarImportJob.findUnique({ where: { id } }).catch(() => null);
      if (current?.status !== "CANCELLED") {
        await this.options.prisma.calendarImportJob.update({
          where: { id },
          data: {
            status: "FAILED",
            stage: "Preparing source",
            errorCode: error instanceof AIServiceError ? error.code : "AI_IMPORT_FAILED",
            errorMessage: publicMessage,
            sourcePath: null,
          },
        }).catch(() => {});
      }
      await disposePrepared?.().catch(() => {});
      disposePrepared = null;
      await this.cleanupSources(paths);
    } finally {
      await disposePrepared?.().catch(() => {});
      if (provider?.dispose) await provider.dispose().catch(() => {});
      if (this.activeControllers.get(id) === controller) this.activeControllers.delete(id);
    }
  }

  async get(userId: string, id: string): Promise<Record<string, unknown> | null> {
    let job = await this.options.prisma.calendarImportJob.findFirst({ where: { id, userId } });
    if (!job) return null;

    // Never leave the client polling forever if a worker disappeared mid-request.
    if (job.status === "PROCESSING" && job.updatedAt.getTime() < Date.now() - STALE_JOB_MS) {
      const paths = safeJson<string[]>(job.sourcePath, []);
      const failed = await this.options.prisma.calendarImportJob.updateMany({
        where: {
          id,
          userId,
          status: "PROCESSING",
          updatedAt: { lt: new Date(Date.now() - STALE_JOB_MS) },
        },
        data: {
          status: "FAILED",
          stage: "Preparing source",
          errorCode: "AI_IMPORT_INTERRUPTED",
          errorMessage: "Schedule extraction was interrupted. Please retry the import.",
          sourcePath: null,
        },
      });
      if (failed.count > 0) {
        this.activeControllers.get(id)?.abort(new Error("Calendar import worker became stale."));
        await this.cleanupSources(paths);
        job = await this.options.prisma.calendarImportJob.findFirst({ where: { id, userId } }) ?? job;
      }
    }

    return publicJob(job);
  }

  async cancel(userId: string, id: string): Promise<boolean> {
    const job = await this.options.prisma.calendarImportJob.findFirst({ where: { id, userId } });
    if (!job) return false;
    const updated = await this.options.prisma.calendarImportJob.updateMany({
      where: { id, userId, status: { in: ["UPLOADED", "PROCESSING", "READY_FOR_REVIEW"] } },
      data: { status: "CANCELLED", stage: "Preparing source", errorCode: "AI_IMPORT_CANCELLED", errorMessage: "Schedule import cancelled." },
    });
    if (updated.count > 0) this.activeControllers.get(id)?.abort(new Error("Calendar import cancelled."));
    const paths = safeJson<string[]>(job.sourcePath, []);
    await this.cleanupSources(paths);
    await this.options.prisma.calendarImportJob.updateMany({
      where: { id, userId },
      data: { sourcePath: null },
    });
    return updated.count > 0;
  }

  async updateReview(userId: string, id: string, value: unknown): Promise<Record<string, unknown>> {
    const update: ReviewUpdate = reviewUpdateSchema.parse(value);
    const job = await this.options.prisma.calendarImportJob.findFirst({ where: { id, userId, status: "READY_FOR_REVIEW" } });
    if (!job) throw new Error("Import job is not ready for review.");
    const preview = calendarImportPreviewSchema.parse(job.previewData);
    const originals = new Map(preview.candidates.map((candidate) => [candidate.candidateId, candidate]));
    if (update.candidates.length !== originals.size || update.candidates.some((candidate) => !originals.has(candidate.candidateId))) {
      throw new Error("Review candidates do not belong to this import job.");
    }
    const candidates = update.candidates.map((candidate) => {
      const original = originals.get(candidate.candidateId)!;
      const parsed = calendarCandidateSchema.parse({
        ...candidate,
        sourcePage: original.sourcePage,
        sourceImageIndex: original.sourceImageIndex,
        rawDate: original.rawDate,
        rawStartTime: original.rawStartTime,
        rawEndTime: original.rawEndTime,
        verification: original.verification,
      });
      const valid = Boolean(
        parsed.title &&
        parsed.eventType &&
        parsed.targetGroups.length > 0 &&
        candidateDateTime(parsed) &&
        (job.sourceMime === "text/plain" || parsed.sourcePage !== null || parsed.sourceImageIndex !== null),
      );
      const humanReview = valid
        ? {
            status: "AMBIGUOUS" as const,
            issues: ["Candidate values were edited by an administrator and require human review."],
          }
        : original.verification;
      return {
        ...parsed,
        status: valid ? "NEEDS_REVIEW" as const : "INVALID" as const,
        selected: valid,
        verification: humanReview,
        warnings: valid
          ? [...new Set([...parsed.warnings, "Candidate was edited by an administrator."])]
          : [...new Set([...parsed.warnings, "Review values are incomplete or invalid."])],
      };
    });
    const next = { ...preview, candidates };
    const saved = await this.options.prisma.calendarImportJob.update({ where: { id }, data: { previewData: next } });
    return publicJob(saved);
  }

  async commit(userId: string, id: string, value: unknown): Promise<CommitResult> {
    const request: CommitRequest = commitRequestSchema.parse(value);
    const job = await this.options.prisma.calendarImportJob.findFirst({ where: { id, userId } });
    if (!job) throw new Error("Import job not found.");
    if (job.status === "COMPLETED") return { inserted: 0, alreadyImported: request.candidateIds.length, duplicatesSkipped: 0, conflictsSkipped: 0, invalidRejected: 0, events: [] };
    if (job.status !== "READY_FOR_REVIEW" && job.status !== "IMPORTING") throw new Error("Import job is not ready to commit.");
    const preview = calendarImportPreviewSchema.parse(job.previewData);
    const selected = preview.candidates.filter((candidate) => request.candidateIds.includes(candidate.candidateId));
    if (selected.length !== request.candidateIds.length) throw new Error("One or more candidates do not belong to this import job.");
    await this.options.prisma.calendarImportJob.updateMany({
      where: { id, userId, status: "READY_FOR_REVIEW" },
      data: { status: "IMPORTING", stage: "Importing" },
    });
    const result = await this.options.prisma.$transaction(async (tx) => {
      const output: CommitResult = { inserted: 0, alreadyImported: 0, duplicatesSkipped: 0, conflictsSkipped: 0, invalidRejected: 0, events: [] };
      const existing = await tx.calendarEvent.findMany({ take: 1000 });
      const mappedExisting: ExistingCalendarEvent[] = existing.map((event) => ({
        id: event.id,
        title: event.title,
        eventType: event.eventType,
        startDateTime: event.startDateTime,
        endDateTime: event.endDateTime,
        targetGroups: event.targetGroups,
        subjectId: event.subjectId,
        importFingerprint: event.importFingerprint,
      }));
      for (const candidate of selected) {
        if ((!candidate.selected && !(candidate.status === "CONFLICT" && request.allowConflicts)) ||
          candidate.status === "INVALID" || !candidateDateTime(candidate) || !candidate.title || !candidate.eventType || candidate.targetGroups.length === 0) {
          output.invalidRejected += 1;
          continue;
        }
        if (candidate.status === "DUPLICATE") {
          output.duplicatesSkipped += 1;
          continue;
        }
        if (candidate.status === "CONFLICT" && !request.allowConflicts) {
          output.conflictsSkipped += 1;
          continue;
        }
        const dateTime = candidateDateTime(candidate)!;
        const fingerprint = computeFingerprint(job.sourceSha256, candidate);
        if (!fingerprint) {
          output.invalidRejected += 1;
          continue;
        }
        const duplicate = mappedExisting.find((event) => event.importFingerprint === fingerprint);
        if (duplicate) {
          output.alreadyImported += 1;
          continue;
        }
        const comparison = compareCandidateToEvents(candidate, mappedExisting);
        if (comparison.duplicate) {
          output.duplicatesSkipped += 1;
          continue;
        }
        if (comparison.conflict && !request.allowConflicts) {
          output.conflictsSkipped += 1;
          continue;
        }
        const created = await tx.calendarEvent.create({
          data: {
            userId: null,
            title: candidate.title,
            eventType: candidate.eventType,
            startDateTime: dateTime.startDateTime,
            endDateTime: dateTime.endDateTime,
            allDay: candidate.allDay,
            targetGroups: candidate.targetGroups.join(","),
            description: candidate.description,
            subjectId: candidate.subjectId,
            room: candidate.room,
            doctor: candidate.doctor,
            importSource: "AI_SCHEDULE_IMPORT",
            sourceDocumentName: job.sourceFileName,
            sourceDocumentSha256: job.sourceSha256,
            sourcePage: candidate.sourcePage,
            importFingerprint: fingerprint,
          },
        });
        mappedExisting.push({
          id: created.id,
          title: created.title,
          eventType: created.eventType,
          startDateTime: created.startDateTime,
          endDateTime: created.endDateTime,
          targetGroups: created.targetGroups,
          subjectId: created.subjectId,
          importFingerprint: created.importFingerprint,
        });
        output.inserted += 1;
        output.events.push({ ...created, targetGroups: created.targetGroups.split(",").filter(Boolean) });
      }
      return output;
    });
    await this.options.prisma.calendarImportJob.update({
      where: { id },
      data: { status: "COMPLETED", stage: "Completed", completedAt: new Date() },
    });
    if (result.events.length > 0) await this.options.onCalendarUpsert?.(result.events);
    return result;
  }
}

export { publicJob };