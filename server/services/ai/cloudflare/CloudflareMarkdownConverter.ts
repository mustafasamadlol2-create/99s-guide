import sharp from "sharp";
import { AIServiceError, isAIServiceError } from "../errors.js";
import type {
  AIContentPart,
  AIFilePart,
  AIStagedFileCapability,
  AIPdfFilePart,
} from "../input/contracts.js";
import { isTrustedAIStagedFileCapability } from "../input/temporaryFiles.js";
import {
  DEFAULT_CLOUDFLARE_MARKDOWN_TIMEOUT_MS,
  DEFAULT_CLOUDFLARE_VISION_TIMEOUT_MS,
  type CloudflareConfig,
} from "../config.js";
import { CloudflareClient } from "./CloudflareClient.js";
import {
  extractPDFPageProfiles,
  renderSelectedPDFPages,
  type PDFTextPageProfile,
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

const PDF_MIN_USABLE_TEXT_CHARS = 60;
const VISION_RENDER_BATCH_SIZE = 6;
const VISION_MAX_DIMENSION = 2_600;

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

function textCharacterCount(text: string): number {
  return text.replace(/\s/gu, "").length;
}

function shouldReadPageVisually(profile: PDFTextPageProfile): boolean {
  // Preserve all visual information: a mixed page is not considered "done" just
  // because pdf.js extracted text from it. Any embedded raster content receives
  // Cloudflare visual reading, while text-only pages stay on the fast local path.
  return textCharacterCount(profile.text) < PDF_MIN_USABLE_TEXT_CHARS || profile.imageCount > 0;
}

function comparableText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 12_000);
}

function combineTextAndVisual(textLayer: string, visual: string | undefined): string {
  const text = textLayer.trim();
  const vision = visual?.trim() ?? "";
  if (!text) return vision;
  if (!vision) return text;

  const comparableLayer = comparableText(text);
  const comparableVision = comparableText(vision);
  if (
    comparableLayer.length >= 24 &&
    comparableVision.length >= 24 &&
    (comparableLayer.includes(comparableVision) || comparableVision.includes(comparableLayer))
  ) {
    return text.length >= vision.length ? text : vision;
  }
  return `${text}\n\n[Visual/OCR content from the same page]\n${vision}`;
}

function createBoundedSignal(
  timeoutMs: number,
  externalSignal?: AbortSignal,
): { signal: AbortSignal; cleanup(): void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Cloudflare media request timed out.")), timeoutMs);
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    },
  };
}

export class CloudflareMarkdownConverter {
  private readonly markdownTimeoutMs: number;
  private readonly visionTimeoutMs: number;

  constructor(
    private readonly client: CloudflareClient,
    private readonly resolver?: CloudflareExistingResourceResolver,
    config?: Pick<CloudflareConfig, "markdownTimeoutMs" | "visionTimeoutMs">,
  ) {
    this.markdownTimeoutMs = config?.markdownTimeoutMs ?? DEFAULT_CLOUDFLARE_MARKDOWN_TIMEOUT_MS;
    this.visionTimeoutMs = config?.visionTimeoutMs ?? DEFAULT_CLOUDFLARE_VISION_TIMEOUT_MS;
  }

  async convert(
    contents: AIContentPart[],
    signal: AbortSignal,
  ): Promise<ConvertedCloudflarePart[]> {
    if (contents.some((part) => part.kind === "text")) {
      throw new AIServiceError("AI_INPUT_INVALID", {
        publicMessage: "Only one AI source mode may be submitted.",
        diagnosticMessage: "Cloudflare media conversion received mixed text and binary content.",
      });
    }

    const converted: ConvertedCloudflarePart[] = [];
    for (const part of contents as AIFilePart[]) {
      if (signal.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
      const capability = await this.resolveCapability(part);
      if (part.inputType === "pdf") {
        converted.push(...await this.convertPdf(part, capability, signal));
      } else {
        converted.push(await this.convertImage(part, capability, signal));
      }
    }
    return converted;
  }

  private async convertPdf(
    part: AIPdfFilePart,
    capability: AIStagedFileCapability,
    signal: AbortSignal,
  ): Promise<ConvertedCloudflarePart[]> {
    // Fast path: Cloudflare's native PDF -> Markdown conversion handles the
    // complete document in one request and is dramatically faster than
    // rendering/OCRing every page independently. It is also the best path for
    // dense MCQ sheets and timetable tables, because table structure is kept in
    // one coherent document instead of being split across image OCR calls.
    //
    // The local page-by-page route remains as a bounded fallback for PDFs that
    // Cloudflare cannot convert (or returns as empty), so scanned/unusual PDFs
    // are still recoverable instead of being rejected.
    let directConversionError: unknown;
    try {
      const bytes = await capability.readBytes();
      const markdown = await this.toMarkdownBounded(
        bytes,
        "application/pdf",
        safeFilename(part, part.mimeType),
        signal,
      );
      if (!unusableDocumentConversion(markdown) && textCharacterCount(markdown) >= PDF_MIN_USABLE_TEXT_CHARS) {
        return [{ text: markdown.trim(), inputType: "pdf" }];
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      directConversionError = error;
    }

    let profiles: PDFTextPageProfile[];
    try {
      profiles = await extractPDFPageProfiles(capability, signal);
    } catch (localError) {
      throw new AIServiceError("AI_MEDIA_PROCESSING_FAILED", {
        publicMessage: "Cloudflare Workers AI could not read this PDF.",
        diagnosticMessage: "Cloudflare whole-document conversion and local PDF inspection both failed.",
        cause: directConversionError ?? localError,
        retryable: true,
      });
    }

    if (profiles.length === 0) {
      throw new AIServiceError("AI_EXTRACTION_INCOMPLETE", {
        publicMessage: "The PDF did not contain readable pages.",
        diagnosticMessage: "Cloudflare whole-document conversion was empty and local PDF inspection returned zero pages.",
        cause: directConversionError,
        retryable: true,
      });
    }

    const pagesNeedingVision = profiles.filter(shouldReadPageVisually).map((profile) => profile.page);
    const visualText = new Map<number, string>();

    for (let offset = 0; offset < pagesNeedingVision.length; offset += VISION_RENDER_BATCH_SIZE) {
      if (signal.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
      const pageNumbers = pagesNeedingVision.slice(offset, offset + VISION_RENDER_BATCH_SIZE);
      const rendered = await renderSelectedPDFPages(capability, part.source, pageNumbers, signal);
      const batch = await Promise.all(rendered.map(async (page) => {
        const localProfile = profiles.find((profile) => profile.page === page.page);
        try {
          const text = await this.readVisualImage(page.bytes, page.mimeType, `source-page-${page.page}.png`, signal);
          return { page: page.page, text };
        } catch (error) {
          if (localProfile && textCharacterCount(localProfile.text) >= PDF_MIN_USABLE_TEXT_CHARS) {
            return { page: page.page, text: "" };
          }
          throw error;
        }
      }));
      for (const item of batch) if (item.text.trim()) visualText.set(item.page, item.text.trim());
    }

    const result = profiles.map((profile) => ({
      text: combineTextAndVisual(profile.text, visualText.get(profile.page)),
      inputType: "pdf" as const,
      page: profile.page,
    })).filter((item) => item.text.trim().length > 0);

    if (result.length === 0) {
      throw new AIServiceError("AI_EXTRACTION_INCOMPLETE", {
        publicMessage: "Cloudflare Workers AI could not find readable content in this PDF.",
        diagnosticMessage: "Whole-document conversion, text-layer extraction, and targeted visual OCR were empty.",
        cause: directConversionError,
        retryable: true,
      });
    }

    return result;
  }

  private async convertImage(
    part: Extract<AIFilePart, { inputType: "image" }>,
    capability: AIStagedFileCapability,
    signal: AbortSignal,
  ): Promise<ConvertedCloudflarePart> {
    let bytes: Uint8Array;
    try {
      bytes = await capability.readBytes();
    } catch (error) {
      throw new AIServiceError("AI_MEDIA_PROCESSING_FAILED", {
        publicMessage: "The AI provider could not read the image.",
        diagnosticMessage: "Validated AI image could not be read from staging.",
        cause: error,
      });
    }
    const text = await this.readVisualImage(
      bytes,
      part.mimeType,
      safeFilename(part, part.mimeType),
      signal,
    );
    return {
      text,
      inputType: "image",
      imageIndex: part.source.imageIndex,
    };
  }

  private async prepareVisionBytes(bytes: Uint8Array): Promise<Uint8Array> {
    try {
      const output = await sharp(Buffer.from(bytes), {
        animated: false,
        failOn: "none",
        limitInputPixels: 120_000_000,
      })
        .rotate()
        .resize({
          width: VISION_MAX_DIMENSION,
          height: VISION_MAX_DIMENSION,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 92, mozjpeg: true })
        .toBuffer();
      return new Uint8Array(output);
    } catch (error) {
      throw new AIServiceError("AI_MEDIA_PROCESSING_FAILED", {
        publicMessage: "The image could not be prepared for Cloudflare Workers AI.",
        diagnosticMessage: "Vision raster normalization failed before Cloudflare OCR.",
        cause: error,
      });
    }
  }

  private async readVisualImage(
    bytes: Uint8Array,
    mimeType: string,
    filename: string,
    signal: AbortSignal,
  ): Promise<string> {
    const visionClient = this.client as CloudflareClient & {
      visionToText?: CloudflareClient["visionToText"];
    };
    if (typeof visionClient.visionToText !== "function") {
      return (await this.toMarkdownBounded(bytes, mimeType, filename, signal)).trim();
    }

    const normalized = await this.prepareVisionBytes(bytes);
    try {
      const bounded = createBoundedSignal(this.visionTimeoutMs, signal);
      try {
        const result = await visionClient.visionToText(normalized, "image/jpeg", bounded.signal);
        if (result.text.trim()) return result.text.trim();
      } finally {
        bounded.cleanup();
      }
    } catch (visionError) {
      if (signal.aborted) throw signal.reason ?? visionError;
      // Cloudflare's vision model and Markdown Conversion are separate Workers AI
      // paths. A bounded image Markdown fallback prevents a model-specific issue
      // from turning into an endless job while remaining 100% on Cloudflare.
      try {
        const markdown = await this.toMarkdownBounded(
          normalized,
          "image/jpeg",
          filename.replace(/\.[^.]+$/u, ".jpg"),
          signal,
        );
        if (!unusableDocumentConversion(markdown)) return markdown.trim();
      } catch (markdownError) {
        if (signal.aborted) throw signal.reason ?? markdownError;
        throw isAIServiceError(visionError) ? visionError : markdownError;
      }
      throw visionError;
    }

    throw new AIServiceError("AI_MEDIA_PROCESSING_FAILED", {
      publicMessage: "Cloudflare Workers AI could not read this image.",
      diagnosticMessage: "Cloudflare visual OCR returned no usable content.",
      retryable: true,
    });
  }

  private async toMarkdownBounded(
    bytes: Uint8Array,
    mimeType: string,
    filename: string,
    signal: AbortSignal,
  ): Promise<string> {
    const bounded = createBoundedSignal(this.markdownTimeoutMs, signal);
    try {
      const result = await this.client.toMarkdown(bytes, mimeType, filename, bounded.signal);
      return result.data;
    } catch (error) {
      if (bounded.signal.aborted && !signal.aborted) {
        throw new AIServiceError("AI_TIMEOUT", {
          publicMessage: "Cloudflare document reading timed out.",
          diagnosticMessage: "Cloudflare Markdown Conversion exceeded its per-request timeout.",
          retryable: true,
          cause: error,
        });
      }
      throw error;
    } finally {
      bounded.cleanup();
    }
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
