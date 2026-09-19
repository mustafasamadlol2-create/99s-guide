export interface EmbeddedPdfJpeg {
  bytes: Uint8Array;
  width?: number;
  height?: number;
  offset: number;
}

const IMAGE_MARKER = "/Subtype /Image";
const DCT_MARKER = "/DCTDecode";
const STREAM_MARKER = "stream";
const END_STREAM_MARKER = "endstream";
const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);
const MIN_PAGE_AREA = 250_000;
const MAX_SCANNED_PDF_IMAGES = 40;

function parseDimension(dictionary: string, name: "Width" | "Height"): number | undefined {
  const match = dictionary.match(new RegExp(`\\/${name}\\s+(\\d+)`, "u"));
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function looksLikePageImage(width?: number, height?: number): boolean {
  if (!width || !height) return true;
  return width * height >= MIN_PAGE_AREA && width >= 300 && height >= 300;
}

/**
 * Best-effort extraction for image-only PDFs whose pages are stored as JPEG
 * (DCTDecode) image XObjects. This intentionally does not attempt to be a full
 * PDF parser; it is a safe fallback for common scanned PDFs after normal PDF
 * text conversion yields no usable text.
 */
export function extractEmbeddedJpegsFromPdf(bytes: Uint8Array): EmbeddedPdfJpeg[] {
  const buffer = Buffer.from(bytes);
  const latin1 = buffer.toString("latin1");
  const output: EmbeddedPdfJpeg[] = [];
  let cursor = 0;

  while (output.length < MAX_SCANNED_PDF_IMAGES) {
    const imageIndex = latin1.indexOf(IMAGE_MARKER, cursor);
    if (imageIndex < 0) break;
    cursor = imageIndex + IMAGE_MARKER.length;

    const streamIndex = latin1.indexOf(STREAM_MARKER, imageIndex);
    const endObjectIndex = latin1.indexOf("endobj", imageIndex);
    if (streamIndex < 0 || (endObjectIndex >= 0 && streamIndex > endObjectIndex)) continue;

    const dictStart = Math.max(latin1.lastIndexOf("<<", imageIndex), imageIndex - 4_096);
    const dictionary = latin1.slice(Math.max(0, dictStart), streamIndex);
    if (!dictionary.includes(DCT_MARKER)) continue;

    const width = parseDimension(dictionary, "Width");
    const height = parseDimension(dictionary, "Height");
    if (!looksLikePageImage(width, height)) continue;

    let dataStart = streamIndex + STREAM_MARKER.length;
    if (latin1[dataStart] === "\r" && latin1[dataStart + 1] === "\n") dataStart += 2;
    else if (latin1[dataStart] === "\n" || latin1[dataStart] === "\r") dataStart += 1;

    const endStreamIndex = latin1.indexOf(END_STREAM_MARKER, dataStart);
    if (endStreamIndex < 0) continue;

    const soi = buffer.indexOf(JPEG_SOI, dataStart);
    if (soi < 0 || soi >= endStreamIndex) continue;
    const eoi = buffer.indexOf(JPEG_EOI, soi + 2);
    if (eoi < 0 || eoi + 2 > endStreamIndex + 2) continue;

    output.push({
      bytes: new Uint8Array(buffer.subarray(soi, eoi + 2)),
      width,
      height,
      offset: imageIndex,
    });
  }

  return output.sort((a, b) => a.offset - b.offset);
}

export function hasMeaningfulPdfText(text: string): boolean {
  const normalized = text
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/[\p{P}\p{S}\s_]+/gu, "")
    .trim();
  return Array.from(normalized).length >= 80;
}
