import { AIServiceError } from "../errors.js";
import type { AIStagedFileCapability } from "../input/contracts.js";
import { isTrustedAIStagedFileCapability } from "../input/temporaryFiles.js";

export interface GeminiUploadedFile {
  name?: string;
  uri?: string;
  mimeType?: string;
  state?: string;
  error?: unknown;
}

export interface GeminiFilesClient {
  upload(params: { file: string; config?: { mimeType: string; abortSignal?: AbortSignal } }): Promise<GeminiUploadedFile>;
  get(params: { name: string; config?: { abortSignal?: AbortSignal }}): Promise<GeminiUploadedFile>;
  delete(params: { name: string; config?: { abortSignal?: AbortSignal }}): Promise<unknown>;
}

export interface GeminiFileReference {
  name: string;
  uri: string;
  mimeType: string;
}

export interface GeminiFilesManagerOptions {
  processingTimeoutMs: number;
  pollIntervalMs: number;
  cleanupTimeoutMs?: number;
  /** Test-only clock hooks; production uses the platform clock and timers. */
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

function mediaError(code: "AI_MEDIA_UPLOAD_FAILED" | "AI_MEDIA_PROCESSING_FAILED" | "AI_MEDIA_PROCESSING_TIMEOUT", message: string, cause?: unknown): AIServiceError {
  return new AIServiceError(code, {
    publicMessage: message,
    diagnosticMessage: cause instanceof Error ? cause.message : undefined,
    retryable: code !== "AI_MEDIA_PROCESSING_FAILED",
    cause,
  });
}

function raceAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new Error("aborted"));
    };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

class GeminiProcessingDeadlineError extends Error {
  constructor() {
    super("media processing deadline exceeded");
    this.name = "GeminiProcessingDeadlineError";
  }
}

function raceDeadline<T>(
  operation: Promise<T>,
  deadline: number,
  signal?: AbortSignal,
  now: () => number = Date.now,
): Promise<T> {
  const remaining = Math.max(0, deadline - now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new GeminiProcessingDeadlineError()), remaining);
  });
  return Promise.race([raceAbort(operation, signal), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export class GeminiFilesManager {
  constructor(
    private readonly files: GeminiFilesClient,
    private readonly options: GeminiFilesManagerOptions,
  ) {}

  async uploadAndActivate(source: AIStagedFileCapability, mimeType: string, signal?: AbortSignal): Promise<GeminiFileReference> {
    if (!isTrustedAIStagedFileCapability(source)) {
      throw mediaError("AI_MEDIA_UPLOAD_FAILED", "The AI media upload failed.");
    }
    let uploaded: GeminiUploadedFile;
    let uploadPromise: Promise<GeminiUploadedFile> | undefined;
    try {
      uploadPromise = source.withPath((path) =>
        this.files.upload({ file: path, config: { mimeType, abortSignal: signal } }),
      );
      uploaded = await raceAbort(uploadPromise, signal);
    } catch (error) {
      if (signal?.aborted && uploadPromise) {
        void uploadPromise.then((lateUpload) => {
          if (lateUpload.name) return this.cleanupNames([lateUpload.name]).catch(() => {});
          return undefined;
        }).catch(() => {});
      }
      throw mediaError("AI_MEDIA_UPLOAD_FAILED", "The AI media upload failed.", error);
    }
    if (!uploaded.name || !uploaded.uri || !uploaded.mimeType) {
      if (uploaded.name) await this.cleanupNames([uploaded.name]).catch(() => {});
      throw mediaError("AI_MEDIA_UPLOAD_FAILED", "The AI media upload returned an invalid reference.");
    }
    try {
      const active = await this.waitUntilActive(uploaded, signal);
      return { name: active.name!, uri: active.uri!, mimeType: active.mimeType! };
    } catch (error) {
      await this.cleanupNames([uploaded.name]).catch(() => {});
      throw error;
    }
  }

  private async waitUntilActive(initial: GeminiUploadedFile, signal?: AbortSignal): Promise<GeminiUploadedFile> {
    const now = this.options.now ?? Date.now;
    const deadline = now() + this.options.processingTimeoutMs;
    let current = initial;
    while (true) {
      if (signal?.aborted) throw mediaError("AI_MEDIA_PROCESSING_FAILED", "AI media processing was cancelled.", signal.reason);
      if (current.state === "ACTIVE") return current;
      if (!current.state) {
        throw mediaError("AI_MEDIA_PROCESSING_FAILED", "The AI provider returned an unknown media state.");
      }
      if (current.state === "FAILED") {
        throw mediaError("AI_MEDIA_PROCESSING_FAILED", "The AI provider could not process the media.", current.error);
      }
      if (current.state !== "PROCESSING") {
        throw mediaError("AI_MEDIA_PROCESSING_FAILED", "The AI provider returned an unknown media state.");
      }
      if (now() >= deadline) {
        throw mediaError("AI_MEDIA_PROCESSING_TIMEOUT", "The AI provider took too long to process the media.");
      }
      const waitMilliseconds = Math.min(this.options.pollIntervalMs, Math.max(0, deadline - now()));
      const wait = this.options.sleep
        ? this.options.sleep(waitMilliseconds, signal)
        : new Promise<void>((resolve, reject) => {
          let settled = false;
          const timer = setTimeout(() => {
            settled = true;
            signal?.removeEventListener("abort", abort);
            resolve();
          }, waitMilliseconds);
          const abort = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            reject(signal?.reason ?? new Error("aborted"));
          };
          signal?.addEventListener("abort", abort, { once: true });
        });
      await wait.catch((error) => {
        if (signal?.aborted) throw mediaError("AI_MEDIA_PROCESSING_FAILED", "AI media processing was cancelled.", error);
        throw error;
      });
      try {
        current = await raceDeadline(
          this.files.get({ name: current.name!, config: { abortSignal: signal } }),
          deadline,
          signal,
          now,
        );
      } catch (error) {
        if (error instanceof GeminiProcessingDeadlineError) {
          throw mediaError("AI_MEDIA_PROCESSING_TIMEOUT", "The AI provider took too long to process the media.", error);
        }
        throw mediaError("AI_MEDIA_PROCESSING_FAILED", "The AI provider could not read media status.", error);
      }
    }
  }

  async delete(name: string): Promise<void> {
    await this.cleanupNames([name]);
  }

  async cleanupNames(names: string[]): Promise<void> {
    const controller = new AbortController();
    const timeoutMs = this.options.cleanupTimeoutMs ?? 2_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deletion = Promise.allSettled(
        names.map((name) => this.files.delete({
          name,
          config: { abortSignal: controller.signal },
        })),
      );
      const results = await Promise.race([
        deletion,
        new Promise<PromiseSettledResult<unknown>[]>((_, reject) => {
          deadlineTimer = setTimeout(() => reject(new Error("cleanup timeout")), timeoutMs);
        }),
      ]);
      if (results.some((result) => result.status === "rejected")) {
        throw new AIServiceError("AI_MEDIA_CLEANUP_FAILED", {
          publicMessage: "AI media cleanup was incomplete.",
          diagnosticMessage: "One or more provider media deletions failed.",
        });
      }
    } finally {
      clearTimeout(timer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
    }
  }
}