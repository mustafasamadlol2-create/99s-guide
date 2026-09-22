import { randomUUID } from "node:crypto";
import type { RawAIInput } from "../input/contracts.js";
import type { AIInputService } from "../input/AIInputService.js";
import type { MCQOperationResult } from "../mcq/contracts.js";
import type { FlashcardOperationResult } from "../flashcard/contracts.js";
import type { AIOperation, AIContentTarget, AIInputKind } from "../contracts.js";
import type { AIAdminEngines } from "./createAIAdminRouter.js";
import { AIServiceError } from "../errors.js";
import { mapAIError } from "./errors.js";

export type AIPreviewJobState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface AIPreviewJobProgress {
  stage: "queued" | "preparing" | "reading" | "extracting" | "generating" | "enhancing" | "validating" | "ready" | "failed" | "cancelled";
  completedBatches: number;
  totalBatches?: number;
  itemsRecovered: number;
}

export interface AIPreviewJobView {
  jobId: string;
  state: AIPreviewJobState;
  target: AIContentTarget;
  operation: AIOperation;
  inputKind: AIInputKind;
  progress: AIPreviewJobProgress;
  response?: unknown;
  error?: { code: string; message: string; retryable: boolean };
}

export interface AIPreviewJobManagerOptions {
  terminalTtlMs?: number;
  hardTimeoutMs?: number;
  now?: () => number;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
}

interface JobRecord extends AIPreviewJobView {
  ownerId: string;
  controller: AbortController;
  createdAt: number;
  terminalAt?: number;
  cleanupTimer?: ReturnType<typeof globalThis.setTimeout>;
  hardTimer?: ReturnType<typeof globalThis.setTimeout>;
  releaseLease?: () => void;
}

type OperationResult = MCQOperationResult | FlashcardOperationResult;

export interface CreateAIPreviewJobArgs {
  ownerId: string;
  target: AIContentTarget;
  operation: AIOperation;
  inputKind: AIInputKind;
  lecture: { id: string; name: string };
  requestId: string;
  rawInput: RawAIInput;
  inputService: AIInputService;
  engineFactory: (onBatchComplete?: import("../AIContentService.js").AIContentServiceOptions["onBatchComplete"]) => AIAdminEngines;
  releaseLease?: () => void;
  dispatch: (
    engines: AIAdminEngines,
    parsed: {
      target: AIContentTarget;
      operation: AIOperation;
      options: unknown;
    },
    prepared: import("../input/contracts.js").PreparedAIInput,
    signal: AbortSignal,
  ) => Promise<OperationResult>;
  options: unknown;
  buildResponse: (requestId: string, target: AIContentTarget, lecture: { id: string; name: string }, inputKind: AIInputKind, result: OperationResult) => unknown;
}

export class AIPreviewJobManager {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly terminalTtlMs: number;
  private readonly hardTimeoutMs: number;
  private readonly now: () => number;
  private readonly schedule: typeof globalThis.setTimeout;
  private readonly unschedule: typeof globalThis.clearTimeout;

  constructor(options: AIPreviewJobManagerOptions = {}) {
    this.terminalTtlMs = options.terminalTtlMs ?? 30 * 60_000;
    this.hardTimeoutMs = options.hardTimeoutMs ?? 45 * 60_000;
    this.now = options.now ?? Date.now;
    this.schedule = options.setTimeout ?? globalThis.setTimeout;
    this.unschedule = options.clearTimeout ?? globalThis.clearTimeout;
    if (!Number.isFinite(this.terminalTtlMs) || this.terminalTtlMs < 1_000 ||
      !Number.isFinite(this.hardTimeoutMs) || this.hardTimeoutMs < 60_000) {
      throw new Error("AI preview job retention and hard timeout must be bounded positive values.");
    }
  }

  private scheduleUnreferenced(handler: () => void, delayMs: number): ReturnType<typeof globalThis.setTimeout> {
    const timer = this.schedule(handler, delayMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    return timer;
  }

  create(args: CreateAIPreviewJobArgs): AIPreviewJobView {
    const jobId = randomUUID();
    const record: JobRecord = {
      jobId,
      ownerId: args.ownerId,
      state: "queued",
      target: args.target,
      operation: args.operation,
      inputKind: args.inputKind,
      progress: {
        stage: "queued",
        completedBatches: 0,
        itemsRecovered: 0,
      },
      controller: new AbortController(),
      createdAt: this.now(),
      releaseLease: args.releaseLease,
    };
    this.jobs.set(jobId, record);
    record.hardTimer = this.scheduleUnreferenced(() => {
      if (record.state === "queued" || record.state === "running") {
        record.controller.abort(new Error("AI preview job exceeded its safety ceiling."));
        this.fail(record, new AIServiceError("AI_TIMEOUT", {
          publicMessage: "The AI preview took too long to complete.",
          diagnosticMessage: "Background preview job exceeded its hard safety ceiling.",
          retryable: true,
        }));
      }
    }, this.hardTimeoutMs);
    void this.run(record, args);
    return this.view(record);
  }

  get(jobId: string, ownerId: string): AIPreviewJobView | null {
    const record = this.jobs.get(jobId);
    if (!record || record.ownerId !== ownerId) return null;
    return this.view(record);
  }

  cancel(jobId: string, ownerId: string): AIPreviewJobView | null {
    const record = this.jobs.get(jobId);
    if (!record || record.ownerId !== ownerId) return null;
    if (record.state === "queued" || record.state === "running") {
      record.controller.abort(new Error("AI preview job was cancelled."));
      this.finish(record, "cancelled", undefined, undefined, {
        stage: "cancelled",
        completedBatches: record.progress.completedBatches,
        totalBatches: record.progress.totalBatches,
        itemsRecovered: record.progress.itemsRecovered,
      });
    }
    return this.view(record);
  }

  get activeCount(): number {
    return [...this.jobs.values()].filter((job) => job.state === "queued" || job.state === "running").length;
  }

  private async run(record: JobRecord, args: CreateAIPreviewJobArgs): Promise<void> {
    if (record.state !== "queued") return;
    record.state = "running";
    record.progress = { ...record.progress, stage: "preparing" };
    const engines = args.engineFactory((details) => {
      if (record.state !== "running") return;
      record.progress = {
        ...record.progress,
        completedBatches: details.completedBatches,
        itemsRecovered: record.progress.itemsRecovered + details.itemsReturned,
      };
      console.info(JSON.stringify({
        category: "AI_PREVIEW_BATCH",
        jobId: record.jobId,
        requestId: args.requestId,
        target: args.target,
        operation: args.operation,
        inputKind: args.inputKind,
        batch: details.completedBatches,
        itemsReturned: details.itemsReturned,
        provider: details.provider,
        model: details.model,
      }));
    });
    try {
      const result = await args.inputService.withPreparedInput(args.rawInput, async (prepared) => {
        if (record.state === "cancelled") throw new AIServiceError("AI_TIMEOUT", {
          publicMessage: "The AI preview was cancelled.",
          diagnosticMessage: "Cancelled before engine execution.",
        });
        record.progress = { ...record.progress, stage: "reading" };
        const result = await args.dispatch(engines, {
          target: args.target,
          operation: args.operation,
          options: args.options,
        }, prepared, record.controller.signal);
        record.progress = { ...record.progress, stage: "validating" };
        return result;
      });
      if (record.state !== "running" || record.controller.signal.aborted) return;
      const completedBatches = record.progress.completedBatches;
      this.finish(record, "succeeded", args.buildResponse(args.requestId, args.target, args.lecture, args.inputKind, result), undefined, {
        stage: "ready",
        completedBatches,
        ...(completedBatches > 0 ? { totalBatches: completedBatches } : {}),
        itemsRecovered: record.progress.itemsRecovered,
      });
    } catch (error) {
      if (record.state !== "running") return;
      this.fail(record, error);
    } finally {
      await engines.dispose?.();
      const adopted = args.rawInput.kind === "pdf"
        ? [args.rawInput.file.adoptedFile]
        : args.rawInput.kind === "image"
          ? args.rawInput.files.map((file) => file.adoptedFile)
          : [];
      await Promise.allSettled(adopted.filter(Boolean).map((file) => file!.dispose()));
    }
  }

  private fail(record: JobRecord, error: unknown): void {
    if (record.state === "cancelled" || record.state === "succeeded" || record.state === "failed") return;
    const mapped = mapAIError(error);
    this.finish(record, "failed", undefined, {
      code: mapped.code,
      message: mapped.message,
      retryable: mapped.retryable,
    }, {
      stage: "failed",
      completedBatches: record.progress.completedBatches,
      totalBatches: record.progress.totalBatches,
      itemsRecovered: record.progress.itemsRecovered,
    });
  }

  private finish(
    record: JobRecord,
    state: Exclude<AIPreviewJobState, "queued" | "running">,
    response?: unknown,
    error?: { code: string; message: string; retryable: boolean },
    progress?: AIPreviewJobProgress,
  ): void {
    if (record.terminalAt) return;
    record.state = state;
    record.response = response;
    record.error = error;
    if (progress) record.progress = progress;
    record.terminalAt = this.now();
    record.releaseLease?.();
    record.releaseLease = undefined;
    if (record.hardTimer) this.unschedule(record.hardTimer);
    record.cleanupTimer = this.scheduleUnreferenced(() => this.jobs.delete(record.jobId), this.terminalTtlMs);
  }

  private view(record: JobRecord): AIPreviewJobView {
    return {
      jobId: record.jobId,
      state: record.state,
      target: record.target,
      operation: record.operation,
      inputKind: record.inputKind,
      progress: { ...record.progress },
      ...(record.response === undefined ? {} : { response: record.response }),
      ...(record.error === undefined ? {} : { error: record.error }),
    };
  }
}