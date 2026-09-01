import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "node:crypto";

const DEFAULT_BUCKET = "99s-guide-files";

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const SIGNED_URL_CACHE_SAFETY_MS = 30_000;
const SIGNED_URL_SERVER_REUSE_MS = 30_000;

let cachedClient: S3Client | null = null;
let cachedClientConfigKey = "";

function getSignedUrlCacheKey(storagePath: string, expiresInSeconds: number): string {
  return `${expiresInSeconds}:${storagePath}`;
}


function clearSignedUrlCacheForPath(storagePath: string): void {
  for (const key of signedUrlCache.keys()) {
    if (key.endsWith(`:${storagePath}`)) signedUrlCache.delete(key);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function getConfig() {
  const endpoint = requireEnv("R2_ENDPOINT").replace(/\/+$/, "");
  const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");
  const bucket = (process.env.R2_BUCKET_NAME || DEFAULT_BUCKET).trim();
  const region = (process.env.R2_REGION || "auto").trim() || "auto";

  return {
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucket,
    region,
  };
}

function getR2Client(): { client: S3Client; bucket: string } {
  const config = getConfig();
  const clientConfigKey = [
    config.endpoint,
    config.accessKeyId,
    config.secretAccessKey,
    config.region,
  ].join("\n");

  if (!cachedClient || cachedClientConfigKey !== clientConfigKey) {
    cachedClient = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    cachedClientConfigKey = clientConfigKey;
  }

  return { client: cachedClient, bucket: config.bucket };
}

function assertSafeStoragePath(storagePath: string): void {
  if (!storagePath || storagePath.startsWith("/") || storagePath.includes("..")) {
    throw new Error("Invalid storage path.");
  }
}

function storageErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 300);
  return "Unknown storage error.";
}


const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

const AVATAR_MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function getAvatarPublicBaseUrl(): string {
  return requireEnv("CONTENT_WORKER_BASE_URL").replace(/\/+$/, "");
}

export function isAvatarDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^data:image\/(?:jpeg|png|webp);base64,/i.test(value)
  );
}

function assertValidAvatarBytes(
  fileData: Buffer,
  mimeType: string,
): void {
  if (fileData.length === 0 || fileData.length > AVATAR_MAX_BYTES) {
    throw new Error("Avatar image size is invalid.");
  }

  let valid = false;

  if (mimeType === "image/jpeg") {
    valid =
      fileData.length >= 3 &&
      fileData[0] === 0xff &&
      fileData[1] === 0xd8 &&
      fileData[2] === 0xff;
  }

  if (mimeType === "image/png") {
    valid =
      fileData.length >= 8 &&
      fileData[0] === 0x89 &&
      fileData[1] === 0x50 &&
      fileData[2] === 0x4e &&
      fileData[3] === 0x47;
  }

  if (mimeType === "image/webp") {
    valid =
      fileData.length >= 12 &&
      fileData.subarray(0, 4).toString("ascii") === "RIFF" &&
      fileData.subarray(8, 12).toString("ascii") === "WEBP";
  }

  if (!valid) {
    throw new Error("Avatar image contents do not match its MIME type.");
  }
}

export async function uploadAvatarDataUrlToR2(
  userId: string,
  dataUrl: string,
): Promise<{ storagePath: string; url: string }> {
  const match = dataUrl.match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i,
  );

  if (!match) {
    throw new Error("Unsupported avatar image format.");
  }

  const mimeType = match[1].toLowerCase();
  const extension = AVATAR_MIME_TO_EXTENSION[mimeType];

  if (!extension) {
    throw new Error("Unsupported avatar MIME type.");
  }

  const fileData = Buffer.from(match[2], "base64");

  assertValidAvatarBytes(fileData, mimeType);

  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "_");

  if (!safeUserId) {
    throw new Error("Invalid avatar user ID.");
  }

  // Content hash makes the URL deterministic.
  // Same image => same key. New image => new URL.
  const contentHash = crypto
    .createHash("sha256")
    .update(fileData)
    .digest("hex")
    .slice(0, 32);

  const storagePath = `avatars/${safeUserId}/${contentHash}.${extension}`;

  assertSafeStoragePath(storagePath);

  const { client, bucket } = getR2Client();

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: storagePath,
        Body: fileData,
        ContentType: mimeType,
        ContentDisposition: "inline",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  } catch (error) {
    throw new Error(
      `Cloudflare R2 avatar upload failed: ${storageErrorMessage(error)}`,
    );
  }

  return {
    storagePath,
    url: `${getAvatarPublicBaseUrl()}/${storagePath}`,
  };
}

export async function deleteManagedAvatarByUrl(
  avatarUrl: string,
): Promise<void> {
  if (!avatarUrl) return;

  let parsedUrl: URL;
  let publicBase: URL;

  try {
    parsedUrl = new URL(avatarUrl);
    publicBase = new URL(getAvatarPublicBaseUrl());
  } catch {
    return;
  }

  // Never delete external Google/Unsplash/etc. images.
  if (parsedUrl.origin !== publicBase.origin) {
    return;
  }

  const storagePath = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, "");

  if (!storagePath.startsWith("avatars/")) {
    return;
  }

  assertSafeStoragePath(storagePath);

  const { client, bucket } = getR2Client();

  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: storagePath,
      }),
    );
  } catch (error) {
    throw new Error(
      `Cloudflare R2 avatar delete failed: ${storageErrorMessage(error)}`,
    );
  }
}

export function buildMaterialStoragePath(lectureId: string, materialId: string): string {
  const safeLectureId = lectureId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeMaterialId = materialId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `materials/${safeLectureId}/${safeMaterialId}.pdf`;
}

/**
 * Compatibility export: server.ts already imports this name.
 * The implementation now stores PDFs in Cloudflare R2, not Supabase Storage.
 */
export async function uploadPdfToSupabaseStorage(
  storagePath: string,
  fileData: Buffer,
): Promise<void> {
  assertSafeStoragePath(storagePath);
  const { client, bucket } = getR2Client();

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: storagePath,
        Body: fileData,
        ContentType: "application/pdf",
        ContentDisposition: "inline",
        CacheControl: "private, max-age=3600",
      }),
    );
  } catch (error) {
    throw new Error(`Cloudflare R2 upload failed: ${storageErrorMessage(error)}`);
  }
}

/**
 * Compatibility export: server.ts already imports this name.
 * Generates a short-lived presigned GET URL for the private R2 object.
 */
export async function createSupabaseSignedUrl(
  storagePath: string,
  expiresInSeconds = 300,
): Promise<string> {
  assertSafeStoragePath(storagePath);

  // Cloudflare R2 presigned URLs are signed locally by the AWS SDK. Keep the
  // existing brief server-side reuse so the behavior remains stable for rapid
  // repeated PDF opens.
  const safeExpirySeconds = Math.max(
    1,
    Math.min(Math.floor(expiresInSeconds), 7 * 24 * 60 * 60),
  );
  const cacheKey = getSignedUrlCacheKey(storagePath, safeExpirySeconds);
  const cached = signedUrlCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.url;
  signedUrlCache.delete(cacheKey);

  const { client, bucket } = getR2Client();

  try {
    const signedUrl = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: storagePath,
        ResponseContentType: "application/pdf",
        ResponseContentDisposition: "inline",
      }),
      { expiresIn: safeExpirySeconds },
    );

    const maxSafeReuseMs = Math.max(
      1_000,
      safeExpirySeconds * 1_000 - SIGNED_URL_CACHE_SAFETY_MS,
    );
    const reuseMs = Math.min(SIGNED_URL_SERVER_REUSE_MS, maxSafeReuseMs);
    signedUrlCache.set(cacheKey, { url: signedUrl, expiresAt: now + reuseMs });
    return signedUrl;
  } catch (error) {
    throw new Error(`Cloudflare R2 signed URL failed: ${storageErrorMessage(error)}`);
  }
}

/**
 * Compatibility export: server.ts already imports this name.
 * Deletes the corresponding object from Cloudflare R2.
 */
export async function deleteSupabaseStorageObject(storagePath: string): Promise<void> {
  assertSafeStoragePath(storagePath);
  const { client, bucket } = getR2Client();

  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: storagePath,
      }),
    );
    clearSignedUrlCacheForPath(storagePath);
  } catch (error) {
    throw new Error(`Cloudflare R2 delete failed: ${storageErrorMessage(error)}`);
  }
}
