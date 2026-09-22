import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { assertSafeStoragePath, getR2Client } from "./supabaseStorage.js";
import { RESOURCE_MULTIPART_URL_TTL_SECONDS } from "../../shared/resourceMultipart.js";

const PDF_CONTENT_TYPE = "application/pdf";

export interface ResourceStoredPart {
  partNumber: number;
  etag: string;
  sizeBytes: number;
}

function storageErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : "Unknown storage error.";
}

export async function createResourceMultipartUpload(storagePath: string): Promise<string> {
  assertSafeStoragePath(storagePath);
  const { client, bucket } = getR2Client();
  const result = await client.send(new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: storagePath,
    ContentType: PDF_CONTENT_TYPE,
    ContentDisposition: "inline",
    CacheControl: "private, max-age=3600",
  }));
  if (!result.UploadId) throw new Error("R2 did not return a multipart upload ID.");
  return result.UploadId;
}

export async function createResourcePartUrl(
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
    { expiresIn: RESOURCE_MULTIPART_URL_TTL_SECONDS },
  );
}

export async function listResourceMultipartParts(
  storagePath: string,
  uploadId: string,
): Promise<ResourceStoredPart[]> {
  assertSafeStoragePath(storagePath);
  const { client, bucket } = getR2Client();
  const parts: ResourceStoredPart[] = [];
  let partNumberMarker: string | undefined;
  do {
    const result = await client.send(new ListPartsCommand({
      Bucket: bucket,
      Key: storagePath,
      UploadId: uploadId,
      PartNumberMarker: partNumberMarker,
    }));
    for (const part of result.Parts ?? []) {
      if (
        Number.isSafeInteger(part.PartNumber) &&
        part.PartNumber > 0 &&
        typeof part.ETag === "string" &&
        part.ETag.length > 0 &&
        Number.isSafeInteger(part.Size) &&
        Number(part.Size) >= 0
      ) {
        parts.push({
          partNumber: part.PartNumber,
          etag: part.ETag,
          sizeBytes: Number(part.Size),
        });
      }
    }
    if (!result.IsTruncated) break;
    partNumberMarker = result.NextPartNumberMarker;
  } while (partNumberMarker);
  return parts.sort((a, b) => a.partNumber - b.partNumber);
}

export async function completeResourceMultipartUpload(
  storagePath: string,
  uploadId: string,
  parts: ResourceStoredPart[],
): Promise<void> {
  assertSafeStoragePath(storagePath);
  const { client, bucket } = getR2Client();
  await client.send(new CompleteMultipartUploadCommand({
    Bucket: bucket,
    Key: storagePath,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: parts.map((part) => ({
        PartNumber: part.partNumber,
        ETag: part.etag,
      })),
    },
  }));
}

export async function abortResourceMultipartUpload(
  storagePath: string,
  uploadId: string,
): Promise<void> {
  assertSafeStoragePath(storagePath);
  const { client, bucket } = getR2Client();
  await client.send(new AbortMultipartUploadCommand({
    Bucket: bucket,
    Key: storagePath,
    UploadId: uploadId,
  }));
}

export async function deleteResourceObject(storagePath: string): Promise<void> {
  assertSafeStoragePath(storagePath);
  const { client, bucket } = getR2Client();
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: storagePath }));
  } catch (error) {
    throw new Error(`Cloudflare R2 resource delete failed: ${storageErrorMessage(error)}`, { cause: error });
  }
}

export async function verifyResourceObject(
  storagePath: string,
  expectedSizeBytes: number,
): Promise<{ sizeBytes: number; contentType: string | null; headerBytes: Uint8Array }> {
  assertSafeStoragePath(storagePath);
  const { client, bucket } = getR2Client();
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: storagePath }));
  const sizeBytes = Number(head.ContentLength ?? 0);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes !== expectedSizeBytes) {
    throw new Error("Uploaded PDF size does not match the selected file.");
  }
  const contentType = head.ContentType?.toLowerCase() ?? null;
  if (contentType && contentType !== PDF_CONTENT_TYPE) {
    throw new Error("Uploaded object content type is not application/pdf.");
  }
  const prefix = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: storagePath,
    Range: "bytes=0-1023",
  }));
  const headerBytes = prefix.Body
    ? await prefix.Body.transformToByteArray()
    : new Uint8Array();
  return { sizeBytes, contentType, headerBytes };
}