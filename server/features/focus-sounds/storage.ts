import crypto from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { assertSafeStoragePath, getR2Client } from "../../services/supabaseStorage.js";

export const MAX_FOCUS_SOUND_BYTES = 30 * 1024 * 1024;
export const FOCUS_SOUND_SIGNED_URL_TTL_SECONDS = 6 * 60 * 60;

const MIME_TO_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
});

export type FocusSoundUploadInput = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

function normalizedMime(mime: string): string {
  return mime.trim().toLowerCase();
}

function hasMp3Signature(bytes: Buffer): boolean {
  if (bytes.length < 3) return false;
  if (bytes.subarray(0, 3).toString("ascii") === "ID3") return true;
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

function hasM4aSignature(bytes: Buffer): boolean {
  return bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
}

function hasWavSignature(bytes: Buffer): boolean {
  return bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WAVE";
}

function hasOggSignature(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.subarray(0, 4).toString("ascii") === "OggS";
}

function hasAacSignature(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
}

export function validateFocusSoundUpload(file: FocusSoundUploadInput): {
  mimeType: string;
  extension: string;
} {
  const mimeType = normalizedMime(file.mimetype);
  const extension = MIME_TO_EXTENSION[mimeType];
  if (!extension) throw new Error("FOCUS_SOUND_UNSUPPORTED_AUDIO");
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_FOCUS_SOUND_BYTES) {
    throw new Error("FOCUS_SOUND_INVALID_SIZE");
  }
  if (!file.buffer || file.buffer.byteLength !== file.size) {
    throw new Error("FOCUS_SOUND_INVALID_BYTES");
  }

  const signatureOk = extension === "mp3"
    ? hasMp3Signature(file.buffer)
    : extension === "m4a"
      ? hasM4aSignature(file.buffer)
      : extension === "wav"
        ? hasWavSignature(file.buffer)
        : extension === "ogg"
          ? hasOggSignature(file.buffer)
          : extension === "aac"
            ? hasAacSignature(file.buffer)
            : false;
  if (!signatureOk) throw new Error("FOCUS_SOUND_SIGNATURE_MISMATCH");
  return { mimeType, extension };
}

export function buildFocusSoundStoragePath(extension: string): string {
  return `focus-sounds/${crypto.randomUUID()}.${extension}`;
}

export async function uploadFocusSoundObject(input: {
  storagePath: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<void> {
  assertSafeStoragePath(input.storagePath);
  const { client, bucket } = getR2Client();
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: input.storagePath,
    Body: input.buffer,
    ContentType: input.mimeType,
    ContentDisposition: "inline",
    CacheControl: "private, max-age=3600",
  }));
}

export async function deleteFocusSoundObject(storagePath: string): Promise<void> {
  assertSafeStoragePath(storagePath);
  const { client, bucket } = getR2Client();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: storagePath }));
}

export async function createFocusSoundPlaybackUrl(
  storagePath: string,
  mimeType: string,
): Promise<string> {
  assertSafeStoragePath(storagePath);
  const { client, bucket } = getR2Client();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: storagePath,
      ResponseContentType: mimeType,
      ResponseContentDisposition: "inline",
    }),
    { expiresIn: FOCUS_SOUND_SIGNED_URL_TTL_SECONDS },
  );
}
