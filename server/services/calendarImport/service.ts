import { createHash } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { AIServiceError } from "../ai/errors.js";
import { createConfiguredAIProvider } from "../ai/providerFactory.js";
import type { AIProvider } from "../ai/contracts.js";
import { AIInputService } from "../ai/input/AIInputService.js";
import { AITemporaryFileManager } from "../ai/input/temporaryFiles.js";
import type { SupportedAIBinaryMimeType } from "../ai/input/contracts.js";
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
const STALE_JOB_MS = 15 * 60 * 1000;

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

function asSupportedMime(value: string): SupportedAIBinaryMimeType {
  if (["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(value)) {
    return value as SupportedAIBinaryMimeType;
  }
  return "application/pdf";
}

function isImageMime(value: string): boolean {
  return value.startsWith("image/");
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
    const isPdf = uploads.length === 1 && uploads[0]!.mimeType === "application/pdf";
    const isImages = uploads.every((upload) => isImageMime(upload.mimeType));
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
          claimedMimeType: "application/pdf",
          originalFilename: uploads[0]!.originalName,
        },
      }, async () => {});
    } else {
      await inputService.withPreparedInput({
        kind: "image",
        files: uploads.map((upload, index) => ({
          bytes: new Uint8Array(bytes[index]!),
          claimedMimeType: asSupportedMime(upload.mimeType),
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
  ): Promise<Record<string, unknown>> {
    const validation = await this.validateUploads(uploads);
    const targetGroups = [...new Set(defaultTargetGroups.map((group) => group.trim().toUpperCase()).filter(Boolean))];
    if (targetGroups.length === 0 || targetGroups.some((group) => !isCalendarTargetGroup(group))) {
      throw new AIServiceError("AI_VALIDATION_ERROR", {
        publicMessage: "Select a valid default audience for schedule events.",
        diagnosticMessage: "Calendar import default target groups were invalid.",
      });
    }
    const job = await this.options.prisma.calendarImportJob.create({
      data: {
        userId,
        status: "UPLOADED",
        stage: "Uploading",
        sourceFileName: uploads.length === 1 ? uploads[0]!.originalName : `${uploads.length} schedule images`,
        sourceMime: validation.inputKind === "pdf"
          ? "application/pdf"
          : JSON.stringify(uploads.map((upload) => upload.mimeType)),
        sourceSha256: validation.sourceHash,
        sourcePath: JSON.stringify(uploads.map((upload) => upload.path)),
        defaultTargetGroups: targetGroups.includes("ALL") ? "ALL" : targetGroups.join(","),
      },
    });
    void this.process(job.id).catch(() => {});
    return publicJob(job);
  }

  async recoverStaleJobs(): Promise<void> {
    const stale = await this.options.prisma.calendarImportJob.findMany({
      where: {
        status: "PROCESSING",
        updatedAt: { lt: new Date(Date.now() - STALE_JOB_MS) },
      },
      select: { id: true, sourcePath: true },
    });
    await this.options.prisma.calendarImportJob.updateMany({
      where: {
        status: "PROCESSING",
        updatedAt: { lt: new Date(Date.now() - STALE_JOB_MS) },
      },
      data: {
        status: "FAILED",
        stage: "Preparing source",
        errorCode: "AI_IMPORT_INTERRUPTED",
        errorMessage: "Schedule extraction was interrupted. Please retry the import.",
      },
    });
    await Promise.all(stale.map((job) => this.cleanupSources(safeJson<string[]>(job.sourcePath, []))));
  }

  private async prepareContents(job: {
    sourcePath: string | null;
    sourceMime: string;
    sourceFileName: string;
  }): Promise<{
    contents: import("../ai/input/contracts.js").AIContentPart[];
    dispose: () => Promise<void>;
    inputKind: "pdf" | "image";
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
    const mimeTypes = safeJson<string[]>(job.sourceMime, []);
    const prepared = await inputService.prepare({
      kind: "image",
      files: paths.map((path, index) => ({
        bytes: new Uint8Array(bytes[index]!),
        claimedMimeType: asSupportedMime(mimeTypes[index] ?? "image/png"),
        originalFilename: path.split(sep).pop() ?? `schedule-${index + 1}`,
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
      const extracted = await extractSchedule({
        provider: this.providerFactory(),
        contents: prepared.contents,
        sourcePageCount: pageCount,
        inputKind: prepared.inputKind,
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
        }),
      );
      const verification = await verifySchedule(
        this.providerFactory(),
        prepared.contents,
        normalized.map((item) => ({ candidateId: item.candidate.candidateId, candidate: item.candidate })),
        {},
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
      await this.cleanupSources(paths);
    }
  }

  async get(userId: string, id: string): Promise<Record<string, unknown> | null> {
    const job = await this.options.prisma.calendarImportJob.findFirst({ where: { id, userId } });
    return job ? publicJob(job) : null;
  }

  async cancel(userId: string, id: string): Promise<boolean> {
    const job = await this.options.prisma.calendarImportJob.findFirst({ where: { id, userId } });
    if (!job) return false;
    const updated = await this.options.prisma.calendarImportJob.updateMany({
      where: { id, userId, status: { in: ["UPLOADED", "PROCESSING", "READY_FOR_REVIEW"] } },
      data: { status: "CANCELLED", stage: "Preparing source", errorCode: "AI_IMPORT_CANCELLED", errorMessage: "Schedule import cancelled." },
    });
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
        (parsed.sourcePage !== null || parsed.sourceImageIndex !== null),
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