import { getApiUrl } from "../../core/api/api";
import { apiClient } from "../../core/api/apiClient";
import {
  MAX_MODULE_RESOURCE_PART_UPLOAD_CONCURRENCY,
  MODULE_RESOURCE_MULTIPART_PART_SIZE_BYTES,
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

export async function getModuleResourcePartUrl(
  resourceId: string,
  partNumber: number,
): Promise<PartUrlResponse> {
  const response = await apiClient(
    `/api/admin/module-resources/upload/${encodeURIComponent(resourceId)}/part-url`,
    {
      method: "POST",
      timeoutMs: 20_000,
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

function putWithProgress(
  url: string,
  body: Blob,
  signal: AbortSignal,
  onProgress: (loaded: number) => void,
): Promise<string | null> {
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
        resolve(xhr.getResponseHeader("ETag"));
      } else {
        reject(new Error(`Storage upload failed with HTTP ${xhr.status}.`));
      }
    };
    xhr.onerror = () => reject(new Error("Network interruption during upload."));
    xhr.onabort = () => reject(new DOMException("The upload was cancelled.", "AbortError"));
    const abort = () => xhr.abort();
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(body);
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
      if (signal.aborted || attempt === 2) throw error;
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
      if (!init.uploadUrl) throw new Error("The upload URL was not returned.");
      await putWithRetries(init.uploadUrl, file, signal, (loaded) => {
        onProgress(loaded, file.size);
      });
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