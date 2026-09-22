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

function emptyDiagnosticLine(value: string): boolean {
  const normalized = value.trim().replace(/^[-*#>\s]+/gu, "").replace(/\s+/gu, " ");
  if (!normalized) return true;
  return /^(?:the\s+)?(?:page|document|source(?:\s+document)?)\s+(?:is|appears)\s+empty[.!]?$/iu.test(normalized) ||
    /^(?:this\s+)?page\s+(?:contains|has)\s+no\s+(?:readable\s+)?(?:text|content)[.!]?$/iu.test(normalized) ||
    /^no\s+(?:readable\s+)?(?:text|content)\s+(?:was\s+)?(?:found|detected|extracted)[.!]?$/iu.test(normalized) ||
    /^(?:unable|failed|could\s+not)\s+to\s+(?:extract|read|detect|find)\s+(?:any\s+)?(?:text|content)[.!]?$/iu.test(normalized);
}

function unusableDocumentConversion(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return true;
  if (/(?:no|without|unable to|failed to|could not)\s+(?:extract|read|detect|find)\s+(?:any\s+)?(?:text|content)/iu.test(normalized)) {
    return true;
  }
  const lines = normalized.split(/\r?\n/gu).map((line) => line.trim()).filter(Boolean);
  if (lines.length && lines.every(emptyDiagnosticLine)) return true;
  const meaningful = lines.filter((line) => !emptyDiagnosticLine(line)).join(" ");
  return textCharacterCount(meaningful) < 24 && lines.some(emptyDiagnosticLine);
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
    let profiles: PDFTextPageProfile[];
    try {
      // Inspect the local PDF structure first. This is fast and prevents a
      // scanner-only PDF from being incorrectly accepted when Cloudflare
      // toMarkdown returns placeholder text such as "The page is empty.".
      profiles = await extractPDFPageProfiles(capability, signal);
    } catch (error) {
      profiles = [];
    }

    const textRichPages = profiles.filter((profile) =>
      textCharacterCount(profile.text) >= PDF_MIN_USABLE_TEXT_CHARS).length;
    const mostlyScanned = profiles.length > 0 && textRichPages / profiles.length < 0.5;
    let directMarkdown = "";
    let directConversionError: unknown;

    // Text-rich PDFs, especially timetables, often preserve tables best through
    // Cloudflare's native PDF-to-Markdown path. Scanner-only PDFs skip this fast
    // path and go directly to rendered-page vision OCR.
    if (!mostlyScanned) {
      try {
        const bytes = await capability.readBytes();
        const markdown = await this.toMarkdownBounded(
          bytes,
          "application/pdf",
          safeFilename(part, part.mimeType),
          signal,
        );
        if (!unusableDocumentConversion(markdown) &&
          textCharacterCount(markdown) >= PDF_MIN_USABLE_TEXT_CHARS) {
          directMarkdown = markdown.trim();
        }
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? error;
        directConversionError = error;
      }
    }

    if (profiles.length === 0) {
      if (directMarkdown) return [{ text: directMarkdown, inputType: "pdf" }];
      throw new AIServiceError("AI_MEDIA_PROCESSING_FAILED", {
        publicMessage: "Cloudflare Workers AI could not read this PDF.",
        diagnosticMessage: "PDF inspection and whole-document conversion both failed.",
        cause: directConversionError,
        retryable: true,
      });
    }

    // For a scanned PDF every page needs vision. For text/mixed PDFs, only
    // pages with insufficient text or embedded raster content need a visual
    // augmentation pass. This keeps ordinary lecture PDFs fast.
    const pagesNeedingVision = (mostlyScanned ? profiles : profiles.filter(shouldReadPageVisually))
      .map((profile) => profile.page);
    const visualText = new Map<number, string>();

    for (let offset = 0; offset < pagesNeedingVision.length; offset += VISION_RENDER_BATCH_SIZE) {
      if (signal.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
      const pageNumbers = pagesNeedingVision.slice(offset, offset + VISION_RENDER_BATCH_SIZE);
      const rendered = await renderSelectedPDFPages(capability, part.source, pageNumbers, signal);
      const batch = await Promise.all(rendered.map(async (page) => {
        const localProfile = profiles.find((profile) => profile.page === page.page);
        try {
          const value = await this.readVisualImage(page.bytes, page.mimeType, `source-page-${page.page}.png`, signal);
          return { page: page.page, text: value };
        } catch (error) {
          // A healthy text layer is still usable if visual augmentation fails.
          if (localProfile && textCharacterCount(localProfile.text) >= PDF_MIN_USABLE_TEXT_CHARS) {
            return { page: page.page, text: "" };
          }
          throw error;
        }
      }));
      for (const item of batch) {
        if (item.text.trim() && !unusableDocumentConversion(item.text)) {
          visualText.set(item.page, item.text.trim());
        }
      }
    }

    // A good whole-document conversion is kept because it preserves table
    // relationships. Visual page augmentations are appended separately so
    // diagrams/scanned inserts are not lost.
    if (directMarkdown) {
      const result: ConvertedCloudflarePart[] = [{ text: directMarkdown, inputType: "pdf" }];
      for (const page of pagesNeedingVision) {
        const visual = visualText.get(page);
        if (visual) result.push({ text: visual, inputType: "pdf", page });
      }
      return result;
    }

    const result = profiles.map((profile) => ({
      text: combineTextAndVisual(profile.text, visualText.get(profile.page)),
      inputType: "pdf" as const,
      page: profile.page,
    })).filter((item) => item.text.trim().length > 0 && !unusableDocumentConversion(item.text));

    if (result.length === 0) {
      throw new AIServiceError("AI_EXTRACTION_INCOMPLETE", {
        publicMessage: "Cloudflare Workers AI could not find readable content in this PDF.",
        diagnosticMessage: "Text-layer extraction and rendered-page visual OCR produced no usable source content.",
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
    const normalized = await this.prepareVisionBytes(bytes);

    const markdownFallback = async (): Promise<string | null> => {
      try {
        const markdown = await this.toMarkdownBounded(
          normalized,
          "image/jpeg",
          filename.replace(/\.[^.]+$/u, ".jpg"),
          signal,
        );
        return !unusableDocumentConversion(markdown) ? markdown.trim() : null;
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? error;
        return null;
      }
    };

    if (typeof visionClient.visionToText !== "function") {
      const markdown = await markdownFallback();
      if (markdown) return markdown;
      throw new AIServiceError("AI_MEDIA_PROCESSING_FAILED", {
        publicMessage: "Cloudflare Workers AI could not read this image.",
        diagnosticMessage: "No vision client was available and image Markdown conversion returned no usable text.",
        retryable: true,
      });
    }

    let lastVisionError: unknown;
    const questions = [
      undefined,
      "This image is a document page that contains visible educational text. Transcribe all visible text exactly, including question numbers, A/B/C/D options, answers, table cells, dates, times, and headings. Do not say the page is empty unless there are literally no visible marks or text.",
    ];
    for (const question of questions) {
      const bounded = createBoundedSignal(this.visionTimeoutMs, signal);
      try {
        const result = await visionClient.visionToText(normalized, "image/jpeg", bounded.signal, question);
        const value = result.text.trim();
        if (value && !unusableDocumentConversion(value)) return value;
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? error;
        lastVisionError = error;
      } finally {
        bounded.cleanup();
      }
    }

    const markdown = await markdownFallback();
    if (markdown) return markdown;

    throw new AIServiceError("AI_MEDIA_PROCESSING_FAILED", {
      publicMessage: "Cloudflare Workers AI could not read this image.",
      diagnosticMessage: "Cloudflare vision OCR and image Markdown fallback both returned no usable content.",
      cause: lastVisionError,
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
