import { AIServiceError } from "../errors.js";
import type {
  AIContentPart,
  AIFilePart,
  AIStagedFileCapability,
} from "../input/contracts.js";
import { isTrustedAIStagedFileCapability } from "../input/temporaryFiles.js";
import { CloudflareClient } from "./CloudflareClient.js";
import { extractEmbeddedJpegsFromPdf, hasMeaningfulPdfText } from "./scannedPdf.js";

export interface CloudflareExistingResourceResolver {
  resolve(resourceId: string): Promise<{
    capability: AIStagedFileCapability;
    mimeType: string;
    sizeBytes: number;
  }>;
}

export interface ConvertedCloudflarePart {
  text: string;
  inputType: "pdf" | "image";
  imageIndex?: number;
}

function safeFilename(part: AIFilePart, mimeType: string): string {
  if (part.inputType === "pdf") return "source.pdf";
  const extension = mimeType === "image/png"
    ? "png"
    : mimeType === "image/webp"
      ? "webp"
      : "jpg";
  return `image-${part.source.imageIndex + 1}.${extension}`;
}

async function normalizeHeic(
  bytes: Uint8Array,
  mimeType: AIFilePart["mimeType"],
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (mimeType !== "image/heic" && mimeType !== "image/heif") {
    return { bytes, mimeType };
  }
  if (signal.aborted) throw signal.reason ?? new Error("aborted");
  try {
    const sharp = (await import("sharp")).default;
    const converted = await sharp(Buffer.from(bytes)).png().toBuffer();
    if (signal.aborted) throw signal.reason ?? new Error("aborted");
    return { bytes: converted, mimeType: "image/png" };
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? new Error("aborted");
    throw new AIServiceError("AI_INPUT_UNSUPPORTED", {
      publicMessage: "This HEIC/HEIF image could not be prepared for AI analysis. Please convert it to JPEG, PNG, or WebP and try again.",
      diagnosticMessage: "HEIC/HEIF normalization could not be completed.",
      cause: error,
    });
  }
}

async function transcribeScannedPdf(
  client: CloudflareClient,
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<string | null> {
  const pageImages = extractEmbeddedJpegsFromPdf(bytes);
  if (pageImages.length === 0) return null;

  // Keep a small concurrency window so multi-page scans do not serialize every
  // image-conversion request while also avoiding a burst of dozens of model calls.
  const transcriptions = new Array<string>(pageImages.length);
  let nextPage = 0;
  const workers = Array.from({ length: Math.min(3, pageImages.length) }, async () => {
    while (true) {
      const index = nextPage++;
      if (index >= pageImages.length) return;
      if (signal.aborted) throw signal.reason ?? new Error("aborted");
      const result = await client.toMarkdown(
        pageImages[index]!.bytes,
        "image/jpeg",
        `scanned-pdf-page-${index + 1}.jpg`,
        signal,
      );
      transcriptions[index] = result.data.trim();
    }
  });
  await Promise.all(workers);

  const combined = transcriptions
    .map((text, index) => `[PDF page ${index + 1}]\n${text}`)
    .join("\n\n");
  return combined.trim() || null;
}

export class CloudflareMarkdownConverter {
  constructor(
    private readonly client: CloudflareClient,
    private readonly resolver?: CloudflareExistingResourceResolver,
  ) {}

  async convert(
    contents: AIContentPart[],
    signal: AbortSignal,
  ): Promise<ConvertedCloudflarePart[]> {
    if (contents.some((part) => part.kind === "text")) {
      throw new AIServiceError("AI_INPUT_INVALID", {
        publicMessage: "Only one AI source mode may be submitted.",
        diagnosticMessage: "Cloudflare Markdown Conversion received mixed text and binary content.",
      });
    }

    const parts = contents as AIFilePart[];
    const converted: ConvertedCloudflarePart[] = [];
    for (const part of parts) {
      const capability = await this.resolveCapability(part);
      let bytes: Uint8Array;
      try {
        bytes = await capability.readBytes();
      } catch (error) {
        throw new AIServiceError("AI_MEDIA_PROCESSING_FAILED", {
          publicMessage: "The AI provider could not read the media.",
          diagnosticMessage: "Validated AI media could not be read for Cloudflare processing.",
          cause: error,
        });
      }
      const normalized = await normalizeHeic(bytes, part.mimeType, signal);

      if (part.inputType === "image") {
        const markdown = await this.client.toMarkdown(
          normalized.bytes,
          normalized.mimeType,
          safeFilename(part, normalized.mimeType),
          signal,
        );
        converted.push({
          text: markdown.data,
          inputType: "image",
          imageIndex: part.source.imageIndex,
        });
        continue;
      }

      let markdownText = "";
      let conversionError: unknown;
      try {
        const markdown = await this.client.toMarkdown(
          normalized.bytes,
          normalized.mimeType,
          safeFilename(part, normalized.mimeType),
          signal,
        );
        markdownText = markdown.data.trim();
        if (hasMeaningfulPdfText(markdownText)) {
          converted.push({ text: markdownText, inputType: "pdf" });
          continue;
        }
      } catch (error) {
        conversionError = error;
      }

      // Cloudflare's normal PDF conversion extracts the PDF text layer. Many
      // exam handouts are actually full-page scanned JPEGs with no text layer.
      // When that happens, convert the embedded page JPEGs through Cloudflare's
      // documented image-to-Markdown vision pipeline instead of silently
      // returning zero MCQs.
      const scannedText = await transcribeScannedPdf(this.client, normalized.bytes, signal);
      if (scannedText) {
        converted.push({ text: scannedText, inputType: "pdf" });
        continue;
      }

      if (markdownText) {
        // Preserve short but legitimate text-only PDFs when no scan fallback is
        // available. The downstream extraction model can decide what is usable.
        converted.push({ text: markdownText, inputType: "pdf" });
        continue;
      }

      if (conversionError) throw conversionError;
      throw new AIServiceError("AI_MEDIA_PROCESSING_FAILED", {
        publicMessage: "This PDF does not contain readable text or a supported scanned-page image.",
        diagnosticMessage: "PDF conversion returned no meaningful text and no DCT/JPEG page images were available for vision transcription.",
      });
    }
    return converted;
  }

  private async resolveCapability(part: AIFilePart): Promise<AIStagedFileCapability> {
    if (part.fileSource.kind === "staged_file") {
      if (
        !isTrustedAIStagedFileCapability(part.fileSource.capability) ||
        part.fileSource.capability.sizeBytes !== part.sizeBytes
      ) {
        throw new AIServiceError("AI_MEDIA_RESOLUTION_FAILED", {
          publicMessage: "The AI source resource could not be resolved.",
          diagnosticMessage: "Cloudflare received an untrusted or mismatched staged capability.",
        });
      }
      return part.fileSource.capability;
    }
    if (!this.resolver) {
      throw new AIServiceError("AI_MEDIA_RESOLUTION_FAILED", {
        publicMessage: "The AI source resource could not be resolved.",
        diagnosticMessage: "No trusted Cloudflare existing-resource resolver was configured.",
      });
    }
    const resolved = await this.resolver.resolve(part.fileSource.resourceId);
    if (
      !isTrustedAIStagedFileCapability(resolved.capability) ||
      resolved.mimeType !== part.mimeType ||
      resolved.sizeBytes !== part.sizeBytes ||
      resolved.capability.sizeBytes !== part.sizeBytes
    ) {
      throw new AIServiceError("AI_MEDIA_RESOLUTION_FAILED", {
        publicMessage: "The AI source resource could not be resolved.",
        diagnosticMessage: "Resolved Cloudflare resource metadata did not match validated input.",
      });
    }
    return resolved.capability;
  }
}
