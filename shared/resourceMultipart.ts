export const MAX_RESOURCE_PDF_BYTES = 5 * 1024 * 1024 * 1024;
export const SMALL_RESOURCE_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;
export const RESOURCE_MULTIPART_PART_SIZE_BYTES = 32 * 1024 * 1024;
export const RESOURCE_MULTIPART_CONCURRENCY = 3;
export const RESOURCE_MULTIPART_URL_BATCH_SIZE = 16;
export const RESOURCE_MULTIPART_URL_TTL_SECONDS = 15 * 60;
export const RESOURCE_MULTIPART_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const RESOURCE_MULTIPART_MAX_ACTIVE_SESSIONS_PER_ADMIN = 3;
export const RESOURCE_MULTIPART_MAX_PART_ATTEMPTS = 5;

export type ResourceMultipartUploadStatus =
  | "INITIATED"
  | "UPLOADING"
  | "COMPLETING"
  | "COMPLETED"
  | "ABORTED"
  | "EXPIRED"
  | "FAILED";

export interface ResourceMultipartPartPlan {
  partNumber: number;
  offsetBytes: number;
  lengthBytes: number;
}

export function expectedResourceMultipartPartCount(
  fileSizeBytes: number,
  partSizeBytes = RESOURCE_MULTIPART_PART_SIZE_BYTES,
): number {
  if (!Number.isSafeInteger(fileSizeBytes) || fileSizeBytes <= 0) return 0;
  if (!Number.isSafeInteger(partSizeBytes) || partSizeBytes <= 0) return 0;
  return Math.ceil(fileSizeBytes / partSizeBytes);
}

export function shouldUseResourceMultipart(fileSizeBytes: number): boolean {
  return (
    Number.isSafeInteger(fileSizeBytes) &&
    fileSizeBytes > SMALL_RESOURCE_UPLOAD_LIMIT_BYTES &&
    fileSizeBytes <= MAX_RESOURCE_PDF_BYTES
  );
}

export function planResourceMultipartParts(
  fileSizeBytes: number,
  partSizeBytes = RESOURCE_MULTIPART_PART_SIZE_BYTES,
): ResourceMultipartPartPlan[] {
  const count = expectedResourceMultipartPartCount(fileSizeBytes, partSizeBytes);
  return Array.from({ length: count }, (_, index) => ({
    partNumber: index + 1,
    offsetBytes: index * partSizeBytes,
    lengthBytes: Math.min(partSizeBytes, fileSizeBytes - index * partSizeBytes),
  }));
}

export function isResourceMultipartStatus(value: unknown): value is ResourceMultipartUploadStatus {
  return (
    value === "INITIATED" ||
    value === "UPLOADING" ||
    value === "COMPLETING" ||
    value === "COMPLETED" ||
    value === "ABORTED" ||
    value === "EXPIRED" ||
    value === "FAILED"
  );
}