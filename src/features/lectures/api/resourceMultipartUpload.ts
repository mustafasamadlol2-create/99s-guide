import { apiClient } from "../../../core/api/apiClient";
import {
  MAX_RESOURCE_PDF_BYTES,
  RESOURCE_MULTIPART_CONCURRENCY,
  RESOURCE_MULTIPART_MAX_PART_ATTEMPTS,
  RESOURCE_MULTIPART_PART_SIZE_BYTES,
  RESOURCE_MULTIPART_URL_BATCH_SIZE,
  SMALL_RESOURCE_UPLOAD_LIMIT_BYTES,
  planResourceMultipartParts,
  shouldUseResourceMultipart,
} from "../../../../shared/resourceMultipart";

export type ResourceMultipartStage =
  | "preparing"
  | "uploading"
  | "finalizing"
  | "completed"
  | "cancelled"
  | "error";

export interface ResourceMultipartProgress {
  uploadedBytes: number;
  totalBytes: number;
  completedParts: number;
  totalParts: number;
}

interface ResourceMultipartStatus {
  sessionId: string;
  status: string;
  title: string;
  filename: string;
  totalBytes: number;
  partSizeBytes: number;
  expectedPartCount: number;
  completedPartNumbers: number[];
  completedParts?: Array<{ partNumber: number; sizeBytes: number }>;
  uploadedBytes: number;
  expiresAt: string | null;
  lastModifiedMs: number | null;
}

interface ResourceMultipartStart extends ResourceMultipartStatus {
  uploadUrlTtlSeconds: number;
  urlBatchSize: number;
  concurrency: number;
}

const resumeStoragePrefix = "resource-multipart-session:";

function resumeStorageKey(lectureId: string, file: File): string {
  return `${resumeStoragePrefix}${lectureId}:${file.name}:${file.size}:${file.lastModified}`;
}

async function readJson<T>(response: Response): Promise<T> {
  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await response.json() : {};
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : `Upload request failed (${response.status}).`,
    );
  }
  return data as T;
}

async function getStatus(sessionId: string): Promise<ResourceMultipartStatus> {
  return readJson<ResourceMultipartStatus>(
    await apiClient(`/api/materials/uploads/multipart/${encodeURIComponent(sessionId)}`, {
      method: "GET",
      timeoutMs: 20_000,
      retries: 0,
      bypassCache: true,
      silent: true,
    }),
  );
}

async function startSession(
  lectureId: string,
  file: File,
  title: string,
): Promise<ResourceMultipartStart> {
  const key = resumeStorageKey(lectureId, file);
  const previousSessionId = window.localStorage.getItem(key);
  if (previousSessionId) {
    try {
      const previous = await getStatus(previousSessionId);
      const matches =
        previous.filename === file.name &&
        previous.title === title &&
        previous.totalBytes === file.size &&
        previous.lastModifiedMs === file.lastModified &&
        (previous.status === "INITIATED" ||
          previous.status === "UPLOADING" ||
          previous.status === "COMPLETING");
      if (matches) return previous as ResourceMultipartStart;
    } catch {
      // A stale or expired local resume reference is safe to discard.
    }
    window.localStorage.removeItem(key);
  }

  const response = await apiClient("/api/materials/uploads/multipart", {
    method: "POST",
    timeoutMs: 20_000,
    retries: 0,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lectureId,
      filename: file.name,
      mime: "application/pdf",
      size: file.size,
      lastModified: file.lastModified,
      title,
    }),
  });
  const started = await readJson<ResourceMultipartStart>(response);
  window.localStorage.setItem(key, started.sessionId);
  return started;
}

async function requestPartUrls(
  sessionId: string,
  partNumbers: number[],
): Promise<Map<number, string>> {
  const urls = new Map<number, string>();
  for (let offset = 0; offset < partNumbers.length; offset += RESOURCE_MULTIPART_URL_BATCH_SIZE) {
    const batch = partNumbers.slice(offset, offset + RESOURCE_MULTIPART_URL_BATCH_SIZE);
    const response = await apiClient(
      `/api/materials/uploads/multipart/${encodeURIComponent(sessionId)}/parts`,
      {
        method: "POST",
        timeoutMs: 20_000,
        retries: 0,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partNumbers: batch }),
      },
    );
    const data = await readJson<{ parts: Array<{ partNumber: number; uploadUrl: string }> }>(response);
    for (const part of data.parts || []) urls.set(part.partNumber, part.uploadUrl);
  }
  return urls;
}

class PartUploadError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "PartUploadError";
    this.status = status;
  }
}

function putPart(
  url: string,
  body: Blob,
  signal: AbortSignal,
  onProgress: (loadedBytes: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.withCredentials = false;
    xhr.setRequestHeader("Content-Type", "application/pdf");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new PartUploadError(`Storage upload failed with HTTP ${xhr.status}.`, xhr.status));
      }
    };
    xhr.onerror = () => reject(new PartUploadError("Network interruption during upload."));
    xhr.ontimeout = () => reject(new PartUploadError("Part upload timed out."));
    xhr.onabort = () => reject(new DOMException("The upload was cancelled.", "AbortError"));
    const abort = () => xhr.abort();
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(body);
  });
}

export async function uploadLargeResourcePdf(options: {
  lectureId: string;
  title: string;
  file: File;
  signal: AbortSignal;
  onStage: (stage: ResourceMultipartStage) => void;
  onProgress: (progress: ResourceMultipartProgress) => void;
}): Promise<void> {
  const { lectureId, title, file, signal, onStage, onProgress } = options;
  if (!shouldUseResourceMultipart(file.size)) {
    if (file.size > MAX_RESOURCE_PDF_BYTES) {
      throw new Error("File exceeds the 5 GiB Resource limit.");
    }
    throw new Error("This file should use the normal Resource upload path.");
  }

  onStage("preparing");
  const session = await startSession(lectureId, file, title);
  const plans = planResourceMultipartParts(file.size, session.partSizeBytes || RESOURCE_MULTIPART_PART_SIZE_BYTES);
  const completed = new Set(session.completedPartNumbers || []);
  const progress = new Array<number>(plans.length).fill(0);
  for (const part of session.completedParts || []) {
    if (part.partNumber >= 1 && part.partNumber <= progress.length) {
      progress[part.partNumber - 1] = part.sizeBytes;
    }
  }
  const pending = plans.filter((part) => !completed.has(part.partNumber));
  if (session.status === "COMPLETING") {
    onStage("finalizing");
    await readJson(
      await apiClient(`/api/materials/uploads/multipart/${encodeURIComponent(session.sessionId)}/complete`, {
        method: "POST",
        timeoutMs: 120_000,
        retries: 0,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    window.localStorage.removeItem(resumeStorageKey(lectureId, file));
    onProgress({
      uploadedBytes: file.size,
      totalBytes: file.size,
      completedParts: plans.length,
      totalParts: plans.length,
    });
    onStage("completed");
    return;
  }
  const partUrls = pending.length
    ? await requestPartUrls(session.sessionId, pending.map((part) => part.partNumber))
    : new Map<number, string>();
  const refreshPartUrl = async (partNumber: number) => {
    const refreshed = await requestPartUrls(session.sessionId, [partNumber]);
    const url = refreshed.get(partNumber);
    if (!url) throw new Error("The upload authorization was not returned.");
    partUrls.set(partNumber, url);
    return url;
  };

  onStage("uploading");
  const emitProgress = () => {
    onProgress({
      uploadedBytes: progress.reduce((sum, value) => sum + value, 0),
      totalBytes: file.size,
      completedParts: progress.filter((value, index) => value === plans[index]!.lengthBytes).length,
      totalParts: plans.length,
    });
  };
  emitProgress();

  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      if (signal.aborted) throw new DOMException("The upload was cancelled.", "AbortError");
      const index = nextIndex++;
      const plan = pending[index];
      if (!plan) return;
      const body = file.slice(plan.offsetBytes, plan.offsetBytes + plan.lengthBytes);
      let lastError: unknown;
      for (let attempt = 0; attempt < RESOURCE_MULTIPART_MAX_PART_ATTEMPTS; attempt += 1) {
        if (signal.aborted) throw new DOMException("The upload was cancelled.", "AbortError");
        progress[plan.partNumber - 1] = 0;
        emitProgress();
        try {
          await putPart(
            partUrls.get(plan.partNumber) || await refreshPartUrl(plan.partNumber),
            body,
            signal,
            (loaded) => {
              progress[plan.partNumber - 1] = Math.min(plan.lengthBytes, loaded);
              emitProgress();
            },
          );
          progress[plan.partNumber - 1] = plan.lengthBytes;
          completed.add(plan.partNumber);
          emitProgress();
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
          if (error instanceof PartUploadError && (error.status === 400 || error.status === 403)) {
            await refreshPartUrl(plan.partNumber);
          } else if (attempt + 1 < RESOURCE_MULTIPART_MAX_PART_ATTEMPTS) {
            await new Promise((resolve) => window.setTimeout(resolve, Math.min(8_000, 500 * 2 ** attempt)));
          }
        }
      }
      if (lastError) throw lastError;
    }
  };

  try {
    await Promise.all(
      Array.from(
        { length: Math.min(RESOURCE_MULTIPART_CONCURRENCY, pending.length || 1) },
        () => worker(),
      ),
    );
    onStage("finalizing");
    await readJson(
      await apiClient(`/api/materials/uploads/multipart/${encodeURIComponent(session.sessionId)}/complete`, {
        method: "POST",
        timeoutMs: 120_000,
        retries: 0,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    window.localStorage.removeItem(resumeStorageKey(lectureId, file));
    onProgress({
      uploadedBytes: file.size,
      totalBytes: file.size,
      completedParts: plans.length,
      totalParts: plans.length,
    });
    onStage("completed");
  } catch (error) {
    const cancelled = error instanceof DOMException && error.name === "AbortError";
    if (cancelled) {
      try {
        await apiClient(`/api/materials/uploads/multipart/${encodeURIComponent(session.sessionId)}`, {
          method: "DELETE",
          timeoutMs: 20_000,
          retries: 0,
          silent: true,
        });
        window.localStorage.removeItem(resumeStorageKey(lectureId, file));
      } catch {
        // Keep the lightweight resume key when abort cannot reach the control plane.
      }
      onStage("cancelled");
    } else {
      // Keep the session for a later same-file resume after a bounded retry
      // failure or a temporary control-plane/network interruption.
      onStage("error");
    }
    throw error;
  }
}