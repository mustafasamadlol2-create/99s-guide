import { AIServiceError } from "../errors.js";
import type {
  AIContentPart,
  AIFilePart,
  AIStagedFileCapability,
} from "../input/contracts.js";
import { isTrustedAIStagedFileCapability } from "../input/temporaryFiles.js";
import { CloudflareClient } from "./CloudflareClient.js";
import {
  forEachRenderedPDFPage,
  inspectPDFImagePages,
} from "../input/pdfVisualSource.js";

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
  page?: number;
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

function unusableDocumentConversion(text: string): boolean {
  const normalized = text.trim();
  return normalized.length === 0 ||
    /(?:no|without|unable to|failed to|could not)\s+(?:extract|read|detect|find)\s+(?:any\s+)?(?:text|content)/iu.test(normalized);
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
      let markdown: { data: string };
      try {
        markdown = await this.client.toMarkdown(
          bytes,
          part.mimeType,
          safeFilename(part, part.mimeType),
          signal,
        );
      } catch (error) {
        if (
          part.inputType !== "pdf" ||
          !(error instanceof AIServiceError) ||
          error.code !== "AI_MEDIA_PROCESSING_FAILED"
        ) {
          throw error;
        }
        markdown = { data: "" };
      }
      if (part.inputType === "pdf" && unusableDocumentConversion(markdown.data)) {
        let renderedPageCount = 0;
        await forEachRenderedPDFPage(
          capability,
          part.source,
          part.pageCount,
          { maxPages: 20, signal },
          async (page) => {
            const visualMarkdown = await this.client.toMarkdown(
              page.bytes,
              page.mimeType,
              `source-page-${page.page}.png`,
              signal,
            );
            converted.push({
              text: visualMarkdown.data,
              inputType: "pdf",
              page: page.page,
            });
            renderedPageCount += 1;
          },
        );
        if (!renderedPageCount) {
          throw new AIServiceError("AI_EXTRACTION_INCOMPLETE", {
            publicMessage: "The document could not be read completely.",
            diagnosticMessage: "Document conversion returned no usable text and no visual pages were available.",
            retryable: true,
          });
        }
        continue;
      }
      converted.push({
        text: markdown.data,
        inputType: part.inputType,
        ...(part.inputType === "image" ? { imageIndex: part.source.imageIndex } : {}),
      });
      if (part.inputType === "pdf" && part.fileSource.kind === "staged_file") {
        const imagePages = await inspectPDFImagePages(part.fileSource.capability, signal);
        if (imagePages.length > 0) {
          await forEachRenderedPDFPage(
            part.fileSource.capability,
            part.source,
            part.pageCount,
            { maxPages: 20, signal },
            async (page) => {
            const visualMarkdown = await this.client.toMarkdown(
              page.bytes,
              page.mimeType,
              `source-page-${page.page}.png`,
              signal,
            );
            converted.push({
              text: visualMarkdown.data,
              inputType: "pdf",
              page: page.page,
            });
            },
          );
        }
      }
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