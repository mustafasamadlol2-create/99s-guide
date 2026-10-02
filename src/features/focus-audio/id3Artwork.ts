const MAX_ID3_TAG_BYTES = 16 * 1024 * 1024;
const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;
const PICTURE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

interface ParsedPicture {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

function readText(bytes: Uint8Array, start: number, end: number): string {
  let value = "";
  for (let index = start; index < end; index += 1) {
    value += String.fromCharCode(bytes[index] ?? 0);
  }
  return value;
}

function readSyncSafeInteger(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  const parts = [bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]];
  if (parts.some((part) => part === undefined || (part & 0x80) !== 0)) return null;
  return ((parts[0] ?? 0) << 21) |
    ((parts[1] ?? 0) << 14) |
    ((parts[2] ?? 0) << 7) |
    (parts[3] ?? 0);
}

function readBigEndianInteger(bytes: Uint8Array, offset: number, length: number): number | null {
  if (offset < 0 || length < 1 || length > 4 || offset + length > bytes.length) return null;
  let value = 0;
  for (let index = 0; index < length; index += 1) {
    value = value * 256 + (bytes[offset + index] ?? 0);
  }
  return value;
}

function removeUnsynchronisation(bytes: Uint8Array): Uint8Array {
  const decoded = new Uint8Array(bytes.length);
  let output = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    const current = bytes[index] ?? 0;
    const next = bytes[index + 1];
    if (
      current === 0 &&
      output > 0 &&
      decoded[output - 1] === 0xff &&
      (next === undefined || next === 0 || next >= 0xe0)
    ) {
      continue;
    }
    decoded[output] = current;
    output += 1;
  }
  return decoded.subarray(0, output);
}

function findTextTerminator(
  bytes: Uint8Array,
  start: number,
  encoding: number,
): number {
  if (encoding === 1 || encoding === 2) {
    for (let index = start; index + 1 < bytes.length; index += 2) {
      if (bytes[index] === 0 && bytes[index + 1] === 0) return index + 2;
    }
    return -1;
  }
  for (let index = start; index < bytes.length; index += 1) {
    if (bytes[index] === 0) return index + 1;
  }
  return -1;
}

function imageMimeType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) return "image/jpeg";

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    readText(bytes, 1, 4) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) return "image/png";

  if (
    bytes.length >= 12 &&
    (readText(bytes, 0, 4) === "RIFF") &&
    (readText(bytes, 8, 12) === "WEBP")
  ) return "image/webp";

  if (
    bytes.length >= 6 &&
    (readText(bytes, 0, 6) === "GIF87a" || readText(bytes, 0, 6) === "GIF89a")
  ) return "image/gif";

  return null;
}

function parsePictureFrame(
  frameData: Uint8Array,
  frameId: "APIC" | "PIC",
): ParsedPicture | null {
  if (frameData.length < (frameId === "PIC" ? 6 : 5)) return null;
  const encoding = frameData[0] ?? 255;
  if (encoding > 3) return null;

  let cursor = 1;
  let declaredMime: string;
  if (frameId === "PIC") {
    const imageFormat = readText(frameData, cursor, cursor + 3).toUpperCase();
    declaredMime = imageFormat === "JPG"
      ? "image/jpeg"
      : imageFormat === "PNG"
        ? "image/png"
        : "";
    cursor += 3;
  } else {
    let terminator = cursor;
    while (terminator < frameData.length && frameData[terminator] !== 0) terminator += 1;
    if (terminator === frameData.length) return null;
    declaredMime = readText(frameData, cursor, terminator).toLowerCase();
    if (declaredMime === "image/jpg") declaredMime = "image/jpeg";
    cursor = terminator + 1;
  }

  if (!PICTURE_MIME_TYPES.has(declaredMime)) return null;
  if (cursor >= frameData.length) return null;
  cursor += 1; // Picture type.
  cursor = findTextTerminator(frameData, cursor, encoding);
  if (cursor < 0 || cursor >= frameData.length) return null;

  const imageBytes = frameData.subarray(cursor);
  if (imageBytes.length === 0 || imageBytes.length > MAX_ARTWORK_BYTES) return null;
  const detectedMime = imageMimeType(imageBytes);
  if (detectedMime !== declaredMime) return null;

  const copy = new Uint8Array(imageBytes.length);
  copy.set(imageBytes);
  return { bytes: copy, mimeType: detectedMime };
}

/**
 * Reads only an embedded ID3v2 APIC/PIC image from a local audio Blob.
 * Unsupported, malformed, oversized, and non-raster artwork is ignored.
 */
export async function readId3Artwork(file: Blob): Promise<Blob | null> {
  try {
    if (file.size < 10) return null;
    const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (readText(header, 0, 3) !== "ID3") return null;

    const version = header[3] ?? 0;
    const tagFlags = header[5] ?? 0;
    if (version < 2 || version > 4) return null;
    if (version === 2 && (tagFlags & 0x40) !== 0) return null;

    const tagSize = readSyncSafeInteger(header, 6);
    if (
      tagSize === null ||
      tagSize <= 0 ||
      tagSize > MAX_ID3_TAG_BYTES ||
      10 + tagSize > file.size
    ) return null;

    const prefix = new Uint8Array(await file.slice(0, 10 + tagSize).arrayBuffer());
    const footerSize = version === 4 && (tagFlags & 0x10) !== 0 ? 10 : 0;
    const frameEnd = prefix.length - footerSize;
    let cursor = 10;

    if (version === 3 && (tagFlags & 0x40) !== 0) {
      const extendedHeaderSize = readBigEndianInteger(prefix, cursor, 4);
      if (extendedHeaderSize === null || extendedHeaderSize < 6) return null;
      cursor += 4 + extendedHeaderSize;
    } else if (version === 4 && (tagFlags & 0x40) !== 0) {
      const extendedHeaderSize = readSyncSafeInteger(prefix, cursor);
      if (extendedHeaderSize === null || extendedHeaderSize < 4) return null;
      cursor += extendedHeaderSize;
    }
    if (cursor > frameEnd) return null;

    while (cursor + (version === 2 ? 6 : 10) <= frameEnd) {
      const frameHeaderSize = version === 2 ? 6 : 10;
      const frameIdSize = version === 2 ? 3 : 4;
      const frameId = readText(prefix, cursor, cursor + frameIdSize);
      if (!/^[A-Z0-9]+$/u.test(frameId)) break;

      const frameSize = version === 2
        ? readBigEndianInteger(prefix, cursor + 3, 3)
        : version === 4
          ? readSyncSafeInteger(prefix, cursor + 4)
          : readBigEndianInteger(prefix, cursor + 4, 4);
      if (
        frameSize === null ||
        frameSize <= 0 ||
        cursor + frameHeaderSize + frameSize > frameEnd
      ) break;

      const frameDataStart = cursor + frameHeaderSize;
      const frameDataEnd = frameDataStart + frameSize;
      if (frameId === "APIC" || frameId === "PIC") {
        const formatFlags = version === 2 ? 0 : prefix[cursor + 9] ?? 0;
        const unsupportedFlags = version === 3
          ? (formatFlags & 0xe0) !== 0
          : version === 4
            ? (formatFlags & 0x4c) !== 0
            : false;
        if (!unsupportedFlags) {
          let frameData = prefix.subarray(frameDataStart, frameDataEnd);
          const tagUnsynchronised = (tagFlags & 0x80) !== 0;
          const frameUnsynchronised = version === 4 && (formatFlags & 0x02) !== 0;
          if (tagUnsynchronised || frameUnsynchronised) {
            frameData = removeUnsynchronisation(frameData);
          }
          if (version === 4 && (formatFlags & 0x01) !== 0) {
            const dataLengthIndicator = readSyncSafeInteger(frameData, 0);
            if (dataLengthIndicator === null) {
              frameData = new Uint8Array();
            } else {
              frameData = frameData.subarray(4);
            }
          }
          const picture = parsePictureFrame(frameData, frameId);
          if (picture) {
            return new Blob([picture.bytes.buffer as ArrayBuffer], {
              type: picture.mimeType,
            });
          }
        }
      }
      cursor = frameDataEnd;
    }
    return null;
  } catch {
    return null;
  }
}