import { getApiUrl } from "../../core/api/api";
import { apiClient } from "../../core/api/apiClient";
import {
  MAX_MODULE_RESOURCE_PART_UPLOAD_CONCURRENCY,
  MODULE_RESOURCE_MULTIPART_PART_SIZE_BYTES,
  MODULE_RESOURCE_PROXY_UPLOAD_MAX_BYTES,
  MODULE_RESOURCE_TITLE_MAX_LENGTH,
  type ModuleResourceModuleId,
} from "../../../shared/moduleResources";

export interface ModuleResource {
  id: string;
  moduleId: ModuleResourceModuleId;
  title: string;
  fileSizeBytes: number;
  createdAt: string;
}

interface UploadInitResponse {
  resourceId: string;
  uploadType: "single" | "multipart";
  uploadUrl?: string;
  partSizeBytes?: number;
  expiresAt: string;
}

interface PartUrlResponse {
  partNumber: number;
  uploadUrl: string;
}

export type ModuleResourceUploadStage =
  | "preparing"
  | "uploading"
  | "verifying"
  | "saving"
  | "completed"
  | "cancelled"
  | "error";

export function formatModuleResourceSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
  const value = bytes / (1024 * 1024);
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} MiB`;
}

async function parseJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  return data as T;
}

export async function listModuleResources(
  moduleId: ModuleResourceModuleId,
): Promise<ModuleResource[]> {
  const response = await apiClient(`/api/module-resources/${moduleId}`, {
    bypassCache: true,
    ttl: 60_000,
    requestKey: `module-resources:${moduleId}`,
    retries: 0,
    silent: true,
  });
  const data = await parseJson<{ resources?: ModuleResource[] }>(response);
  return Array.isArray(data.resources) ? data.resources : [];
}

export async function resolveModuleResourcePdfUrl(
  resourceId: string,
): Promise<string> {
  const response = await apiClient(
    `/api/module-resources/${encodeURIComponent(resourceId)}/pdf`,
    {
      bypassCache: true,
      silent: true,
      retries: 1,
      retryDelayMs: 250,
      timeoutMs: 8_000,
      requestKey: `module-resource-pdf:${resourceId}`,
    },
  );
  const data = await parseJson<{ url?: string }>(response);
  if (!data.url) throw new Error("The PDF URL was not returned.");
  return data.url.startsWith("/")
    ? getApiUrl(data.url)
    : data.url;
}

export async function initModuleResourceUpload(
  moduleId: ModuleResourceModuleId,
  title: string,
  file: File,
): Promise<UploadInitResponse> {
  const response = await apiClient("/api/admin/module-resources/upload/init", {
    method: "POST",
    timeoutMs: 20_000,
    silent: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      moduleId,
      title: title.trim().slice(0, MODULE_RESOURCE_TITLE_MAX_LENGTH),
      fileSizeBytes: file.size,
      mimeType: "application/pdf",
      originalFilename: file.name,
    }),
  });
  return parseJson<UploadInitResponse>(response);
}

export async function proxyModuleResourceUpload(
  resourceId: string,
  file: File,
  signal: AbortSignal,
): Promise<void> {
  await apiClient(
    `/api/admin/module-resources/upload/${encodeURIComponent(resourceId)}/proxy`,
    {
      method: "POST",
      timeoutMs: 180_000,
      silent: true,
      headers: { "Content-Type": "application/pdf" },
      body: file,
      signal,
    },
  );
}

export async function getModuleResourcePartUrl(
  resourceId: string,
  partNumber: number,
): Promise<PartUrlResponse> {
  const response = await apiClient(
    `/api/admin/module-resources/upload/${encodeURIComponent(resourceId)}/part-url`,
    {
      method: "POST",
      timeoutMs: 20_000,
      silent: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partNumber }),
    },
  );
  return parseJson<PartUrlResponse>(response);
}

export async function completeModuleResourceUpload(
  resourceId: string,
  parts: Array<{ partNumber: number; etag: string }>,
): Promise<ModuleResource> {
  const response = await apiClient(
    `/api/admin/module-resources/upload/${encodeURIComponent(resourceId)}/complete`,
    {
      method: "POST",
      timeoutMs: 45_000,
      silent: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parts }),
    },
  );
  const data = await parseJson<{ resource: ModuleResource }>(response);
  return data.resource;
}

export async function abortModuleResourceUpload(resourceId: string): Promise<void> {
  await apiClient(
    `/api/admin/module-resources/upload/${encodeURIComponent(resourceId)}/abort`,
    {
      method: "POST",
      timeoutMs: 15_000,
      headers: { "Content-Type": "application/json" },
      body: "{}",
      silent: true,
    },
  );
}

export async function deleteModuleResource(resourceId: string): Promise<void> {
  await apiClient(`/api/admin/module-resources/${encodeURIComponent(resourceId)}`, {
    method: "DELETE",
    timeoutMs: 20_000,
    silent: true,
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("The upload was cancelled.", "AbortError"));
      },
      { once: true },
    );
  });
}

export class ModuleResourceDirectUploadError extends Error {
  readonly code = "MODULE_RESOURCE_DIRECT_UPLOAD_BLOCKED";
  readonly origin: string;

  constructor(message: string, origin: string) {
    super(message);
    this.name = "ModuleResourceDirectUploadError";
    this.origin = origin;
  }
}

function currentUploadOrigin(): string {
  try {
    return window.location.origin && window.location.origin !== "null"
      ? window.location.origin
      : `${window.location.protocol}//${window.location.host}`;
  } catch {
    return "unknown-origin";
  }
}

function uploadTimeoutMs(bytes: number): number {
  // Allow very slow mobile connections without permitting a stalled R2/CORS
  // request to sit at 0% forever. The calculation assumes ~128 KiB/s and is
  // bounded between 2 and 15 minutes per PUT/part.
  const estimated = Math.ceil(bytes / (128 * 1024)) * 1000;
  return Math.max(120_000, Math.min(15 * 60_000, estimated));
}

function putWithProgress(
  url: string,
  body: Blob,
  signal: AbortSignal,
  onProgress: (loaded: number) => void,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const origin = currentUploadOrigin();
    let settled = false;
    let uploadedBytes = 0;
    let firstByteTimer: number | null = null;

    const cleanup = () => {
      if (firstByteTimer !== null) {
        window.clearTimeout(firstByteTimer);
        firstByteTimer = null;
      }
      signal.removeEventListener("abort", abort);
      xhr.upload.onprogress = null;
      xhr.onload = null;
      xhr.onerror = null;
      xhr.onabort = null;
      xhr.ontimeout = null;
    };

    const finishResolve = (etag: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(etag);
    };

    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const blockedError = (reason: string) =>
      new ModuleResourceDirectUploadError(
        `${reason} Direct Cloudflare R2 upload could not start from ${origin}. ` +
          "The R2 bucket CORS policy must allow this exact app origin, PUT, and Content-Type; multipart uploads also require ETag to be exposed.",
        origin,
      );

    const abort = () => xhr.abort();

    xhr.open("PUT", url, true);
    xhr.withCredentials = false;
    xhr.timeout = uploadTimeoutMs(body.size);
    xhr.setRequestHeader("Content-Type", "application/pdf");

    xhr.upload.onprogress = (event) => {
      uploadedBytes = event.loaded;
      if (uploadedBytes > 0 && firstByteTimer !== null) {
        window.clearTimeout(firstByteTimer);
        firstByteTimer = null;
      }
      // WebKit does not always set lengthComputable for uploads. event.loaded
      // is still useful and keeps the UI moving whenever bytes are sent.
      onProgress(Math.min(event.loaded, body.size));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(body.size);
        finishResolve(xhr.getResponseHeader("ETag"));
        return;
      }
      finishReject(
        new Error(
          `Cloudflare R2 rejected the upload with HTTP ${xhr.status}. ` +
            "Check the bucket CORS policy and the presigned upload configuration.",
        ),
      );
    };

    xhr.onerror = () => {
      if (uploadedBytes === 0) {
        finishReject(blockedError("The browser could not send the first upload bytes."));
      } else {
        finishReject(new Error("Network interruption during the Cloudflare R2 upload."));
      }
    };

    xhr.ontimeout = () => {
      if (uploadedBytes === 0) {
        finishReject(blockedError("The upload stayed at 0% until it timed out."));
      } else {
        finishReject(new Error("The Cloudflare R2 upload timed out before completion."));
      }
    };

    xhr.onabort = () =>
      finishReject(new DOMException("The upload was cancelled.", "AbortError"));

    signal.addEventListener("abort", abort, { once: true });

    // A valid direct R2 request should begin transmitting quickly. If WebKit
    // remains at exactly 0 bytes for 30 seconds, the most common cause is a
    // failed R2 CORS preflight. Fail explicitly instead of leaving the admin
    // screen stuck at 0% forever.
    firstByteTimer = window.setTimeout(() => {
      if (settled || uploadedBytes > 0) return;
      finishReject(
        blockedError("The upload remained at 0% for 30 seconds."),
      );
      try {
        xhr.abort();
      } catch (_) {}
    }, 30_000);

    try {
      xhr.send(body);
    } catch (error) {
      finishReject(
        error instanceof Error
          ? error
          : new Error("The direct storage upload could not be started."),
      );
    }
  });
}

async function putWithRetries(
  url: string,
  body: Blob,
  signal: AbortSignal,
  onProgress: (loaded: number) => void,
): Promise<string | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    if (signal.aborted) throw new DOMException("The upload was cancelled.", "AbortError");
    onProgress(0);
    try {
      return await putWithProgress(url, body, signal, onProgress);
    } catch (error) {
      lastError = error;
      // A request blocked before its first byte (typically R2 CORS in a
      // browser/WebView) is deterministic. Retrying the same presigned URL
      // only makes the UI appear frozen for several minutes.
      if (
        signal.aborted ||
        error instanceof ModuleResourceDirectUploadError ||
        attempt === 2
      ) {
        throw error;
      }
      await sleep(500 * 2 ** attempt, signal);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Upload failed.");
}

export async function uploadModuleResource(
  file: File,
  moduleId: ModuleResourceModuleId,
  title: string,
  signal: AbortSignal,
  onStage: (stage: ModuleResourceUploadStage) => void,
  onProgress: (uploadedBytes: number, totalBytes: number) => void,
): Promise<ModuleResource> {
  const init = await initModuleResourceUpload(moduleId, title, file);
  const resourceId = init.resourceId;
  try {
    onStage("uploading");
    if (init.uploadType === "single") {
      if (file.size <= MODULE_RESOURCE_PROXY_UPLOAD_MAX_BYTES) {
        // Small PDFs use the authenticated backend as a storage proxy. This
        // avoids browser/WebView CORS false failures against presigned R2 URLs
        // while keeping large files on the direct-to-R2 path.
        onProgress(0, file.size);
        await proxyModuleResourceUpload(resourceId, file, signal);
        onProgress(file.size, file.size);
      } else {
        if (!init.uploadUrl) throw new Error("The upload URL was not returned.");
        await putWithRetries(init.uploadUrl, file, signal, (loaded) => {
          onProgress(loaded, file.size);
        });
      }
    } else {
      const partSize = init.partSizeBytes || MODULE_RESOURCE_MULTIPART_PART_SIZE_BYTES;
      const partCount = Math.ceil(file.size / partSize);
      const uploaded = new Array<number>(partCount).fill(0);
      const completedParts = new Array<{ partNumber: number; etag: string }>(partCount);
      let nextPart = 0;

      const worker = async () => {
        while (true) {
          const index = nextPart++;
          if (index >= partCount) return;
          const partNumber = index + 1;
          const start = index * partSize;
          const end = Math.min(file.size, start + partSize);
          const part = file.slice(start, end);
          const url = await getModuleResourcePartUrl(resourceId, partNumber);
          const etag = await putWithRetries(
            url.uploadUrl,
            part,
            signal,
            (loaded) => {
              uploaded[index] = loaded;
              onProgress(uploaded.reduce((sum, value) => sum + value, 0), file.size);
            },
          );
          if (!etag) throw new Error("Storage did not return a part ETag.");
          completedParts[index] = { partNumber, etag };
        }
      };

      await Promise.all(
        Array.from(
          { length: Math.min(MAX_MODULE_RESOURCE_PART_UPLOAD_CONCURRENCY, partCount) },
          () => worker(),
        ),
      );
      onStage("verifying");
      onStage("saving");
      return await completeModuleResourceUpload(resourceId, completedParts);
    }

    onStage("verifying");
    onStage("saving");
    return await completeModuleResourceUpload(resourceId, []);
  } catch (error) {
    try {
      await abortModuleResourceUpload(resourceId);
    } catch (_) {}
    throw error;
  }
}