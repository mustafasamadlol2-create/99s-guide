import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  assertSafeStoragePath,
  getR2Client,
} from "./supabaseStorage.js";
import {
  MAX_MODULE_RESOURCE_PDF_BYTES,
  MODULE_RESOURCE_MULTIPART_PART_SIZE_BYTES,
  MODULE_RESOURCE_UPLOAD_EXPIRY_SECONDS,
  type ModuleResourceModuleId,
  moduleResourceStoragePath,
} from "../../shared/moduleResources.js";

const PDF_CONTENT_TYPE = "application/pdf";

function storageErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : "Unknown storage error.";
}

export function buildModuleResourceStoragePath(
  moduleId: ModuleResourceModuleId,
  resourceId: string,
): string {
  const storagePath = moduleResourceStoragePath(moduleId, resourceId);
  assertSafeStoragePath(storagePath);
  return storagePath;
}

export async function createModuleResourcePutUrl(
  storagePath: string,
): Promise<string> {
  assertSafeStoragePath(storagePath);
  const { client, bucket } = getR2Client();
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: storagePath,
      ContentType: PDF_CONTENT_TYPE,
      ContentDisposition: "inline",
      CacheControl: "private, max-age=3600",
    }),
    { expiresIn: MODULE_RESOURCE_UPLOAD_EXPIRY_SECONDS },
  );
}

export async function createModuleResourceMultipartUpload(
  storagePath: string,
): Promise<string> {
  assertSafeStoragePath(storagePath);
  const { client, bucket } = getR2Client();
  const result = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: storagePath,
      ContentType: PDF_CONTENT_TYPE,
      ContentDisposition: "inline",
      CacheControl: "private, max-age=3600",
    }),
  );
  if (!result.UploadId) throw new Error("R2 did not return a multipart upload ID.");
  return result.UploadId;
}

export async function createModuleResourcePartUrl(
  storagePath: string,
  uploadId: string,
  partNumber: number,
): Promise<string> {
  assertSafeStoragePath(storagePath);
  const { client, bucket } = getR2Client();
  return getSignedUrl(
    client,
    new UploadPartCommand({
      Bucket: bucket,
      Key: storagePath,
      UploadId: uploadId,
      PartNumber: partNumber,
    }),
    { expiresIn: MODULE_RESOURCE_UPLOAD_EXPIRY_SECONDS },
  );
}

export async function completeModuleResourceMultipartUpload(
  storagePath: string,
  uploadId: string,
  parts: Array<{ PartNumber: number; ETag: string }>,
): Promise<void> {
  assertSafeStoragePath(storagePath);
  const { client, bucket } = getR2Client();
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: storagePath,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }),
  );
}

export async function abortModuleResourceMultipartUpload(
  storagePath: string,
  uploadId: string,
): Promise<void> {
  assertSafeStoragePath(storagePath);
  const { client, bucket } = getR2Client();
  await client.send(
    new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: storagePath,
      UploadId: uploadId,
    }),
  );
}

export async function deleteModuleResourceObject(storagePath: string): Promise<void> {
  const { client, bucket } = getR2Client();
  assertSafeStoragePath(storagePath);
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: storagePath,
      }),
    );
  } catch (error) {
    throw new Error(`Cloudflare R2 module resource delete failed: ${storageErrorMessage(error)}`);
  }
}

export async function verifyModuleResourcePdf(
  storagePath: string,
  expectedSizeBytes: number,
): Promise<{ sizeBytes: number; contentType: string | null }> {
  assertSafeStoragePath(storagePath);
  const { client, bucket } = getR2Client();
  let head;
  try {
    head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: storagePath }),
    );
  } catch (error) {
    throw new Error(`Cloudflare R2 module resource verification failed: ${storageErrorMessage(error)}`);
  }

  const sizeBytes = Number(head.ContentLength ?? 0);
  const contentType = head.ContentType?.toLowerCase() ?? null;
  if (
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > MAX_MODULE_RESOURCE_PDF_BYTES ||
    sizeBytes !== expectedSizeBytes
  ) {
    throw new Error("Uploaded PDF size does not match the requested file size.");
  }
  if (contentType && contentType !== PDF_CONTENT_TYPE) {
    throw new Error("Uploaded object content type is not application/pdf.");
  }

  const prefix = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: storagePath,
      Range: "bytes=0-4",
    }),
  );
  const bytes = prefix.Body ? await prefix.Body.transformToByteArray() : new Uint8Array();
  if (bytes.length < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new Error("The uploaded file is not a valid PDF.");
  }

  return { sizeBytes, contentType };
}

export {
  MAX_MODULE_RESOURCE_PDF_BYTES,
  MODULE_RESOURCE_MULTIPART_PART_SIZE_BYTES,
};