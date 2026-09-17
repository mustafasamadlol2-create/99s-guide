import { open } from "node:fs/promises";
import { AIServiceError } from "../errors.js";
import type { SupportedAIBinaryMimeType } from "./contracts.js";
import { normalizeAIBinaryMimeType } from "./mime.js";

function isPrefix(bytes: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function detectIsoBmffImage(bytes: Uint8Array): SupportedAIBinaryMimeType | null {
  if (bytes.length < 16 || Buffer.from(bytes.subarray(4, 8)).toString("ascii") !== "ftyp") {
    return null;
  }
  const boxSize = Buffer.from(bytes.subarray(0, 4)).readUInt32BE(0);
  if (boxSize < 16 || boxSize > bytes.length || (boxSize - 16) % 4 !== 0) return null;

  const brands = [Buffer.from(bytes.subarray(8, 12)).toString("ascii")];
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) {
    brands.push(Buffer.from(bytes.subarray(offset, offset + 4)).toString("ascii"));
  }
  if (brands.some((brand) =>
    ["heic", "heix", "hevc", "hevx", "heim", "heis"].includes(brand)
  )) {
    return "image/heic";
  }
  if (brands.some((brand) => ["mif1", "msf1"].includes(brand))) return "image/heif";
  return null;
}

export function detectAIBinaryMimeType(
  bytes: Uint8Array,
): SupportedAIBinaryMimeType | null {
  if (Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  if (isPrefix(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (isPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return detectIsoBmffImage(bytes);
}

export async function inspectStagedMimeType(
  path: string,
): Promise<SupportedAIBinaryMimeType | null> {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(256);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return detectAIBinaryMimeType(header.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

export function validateClaimedBinaryMime(
  claimedMimeType: string,
  inputType: "pdf" | "image",
): SupportedAIBinaryMimeType {
  const normalized = normalizeAIBinaryMimeType(claimedMimeType);
  if (!normalized) {
    throw new AIServiceError("AI_INPUT_UNSUPPORTED", {
      publicMessage: "The uploaded file type is not supported.",
      diagnosticMessage: "Claimed MIME type is outside the approved PDF/image set.",
    });
  }
  if (
    (inputType === "pdf" && normalized !== "application/pdf") ||
    (inputType === "image" && normalized === "application/pdf")
  ) {
    throw new AIServiceError("AI_INPUT_INVALID", {
      publicMessage: "The uploaded file type does not match the selected input mode.",
      diagnosticMessage: "Claimed MIME type contradicted the selected input kind.",
    });
  }
  return normalized;
}

export function assertDetectedMimeMatches(
  claimed: SupportedAIBinaryMimeType,
  detected: SupportedAIBinaryMimeType | null,
): asserts detected is SupportedAIBinaryMimeType {
  if (!detected) {
    throw new AIServiceError("AI_INPUT_INVALID", {
      publicMessage: "The uploaded file content is invalid or unsupported.",
      diagnosticMessage: "Binary signature did not match an approved format.",
    });
  }
  if (claimed !== detected) {
    throw new AIServiceError("AI_INPUT_INVALID", {
      publicMessage: "The uploaded file content does not match its declared type.",
      diagnosticMessage: `Claimed MIME ${claimed} did not match detected MIME ${detected}.`,
    });
  }
}