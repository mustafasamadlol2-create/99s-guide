import { AIServiceError } from "../errors.js";
import type {
  AIContentPart,
  AIFilePart,
  AIStagedFileCapability,
} from "../input/contracts.js";
import { isTrustedAIStagedFileCapability } from "../input/temporaryFiles.js";
import { CloudflareClient } from "./CloudflareClient.js";

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
          diagnosticMessage: "Validated AI media could not be read for Markdown Conversion.",
          cause: error,
        });
      }
      const normalized = await normalizeHeic(bytes, part.mimeType, signal);
      const markdown = await this.client.toMarkdown(
        normalized.bytes,
        normalized.mimeType,
        safeFilename(part, normalized.mimeType),
        signal,
      );
      converted.push({
        text: markdown.data,
        inputType: part.inputType,
        ...(part.inputType === "image" ? { imageIndex: part.source.imageIndex } : {}),
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