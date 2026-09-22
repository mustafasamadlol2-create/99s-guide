import sharp from "sharp";
import { AIServiceError } from "../errors.js";
import type {
  AIContentPart,
  AIAdoptedBinaryFile,
  AIFilePart,
  NormalizedImageInput,
  NormalizedPDFInput,
  PreparedAIInput,
  RawAIBinaryInput,
  RawAIInput,
  SupportedAIBinaryMimeType,
} from "./contracts.js";
import { resolveAIInputLimits, type AIInputLimits } from "./config.js";
import { sha256Capability } from "./hash.js";
import { normalizeAIBinaryMimeType, sanitizeDisplayFilename, sanitizeSourceLabel } from "./mime.js";
import { normalizeAIText } from "./normalizeText.js";
import { rawAIInputSchema } from "./schemas.js";
import { AITemporaryFileManager } from "./temporaryFiles.js";
import { inspectPDFPageCount } from "./pdfVisualSource.js";
import {
  assertDetectedMimeMatches,
  inspectStagedMimeType,
  validateClaimedBinaryMime,
} from "./validators.js";


const CONVERTIBLE_IMAGE_MIMES = new Set([
  "image/heic",
  "image/heif",
  "image/avif",
  "image/tiff",
  "image/bmp",
  "image/gif",
  "application/octet-stream",
]);

const IMAGE_EXTENSION_MIMES: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp",
  gif: "image/gif",
};

function extensionOf(filename?: string): string {
  const clean = sanitizeDisplayFilename(filename).toLowerCase();
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1) : "";
}

function inferredMime(raw: RawAIBinaryInput, inputType: "pdf" | "image"): string {
  const claimed = raw.claimedMimeType.trim().toLowerCase();
  const extension = extensionOf(raw.originalFilename);

  // Browser/OS MIME metadata is frequently generic or simply wrong. A recognized
  // extension may select the decoder, but the actual bytes are always validated
  // below before they are trusted or sent to an AI provider.
  if (inputType === "pdf" && extension === "pdf") return "application/pdf";
  if (inputType === "image" && IMAGE_EXTENSION_MIMES[extension]) return IMAGE_EXTENSION_MIMES[extension]!;
  if (normalizeAIBinaryMimeType(claimed)) return claimed;
  return claimed;
}

interface PreparedBinary {
  staged: AIAdoptedBinaryFile;
  displayName: string;
  mimeType: SupportedAIBinaryMimeType;
  sha256: string;
}

export class AIInputService {
  private readonly limits: AIInputLimits;

  constructor(
    limits: Partial<AIInputLimits> = {},
    private readonly temporaryFiles = new AITemporaryFileManager(),
  ) {
    this.limits = resolveAIInputLimits(limits);
  }

  private validateSize(sizeBytes: number, maxBytes: number, inputType: "PDF" | "image"): void {
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
      throw new AIServiceError("AI_INPUT_INVALID", {
        publicMessage: `The ${inputType} input is empty.`,
        diagnosticMessage: `${inputType} byte length was zero or invalid.`,
      });
    }
    if (sizeBytes > maxBytes) {
      throw new AIServiceError("AI_INPUT_TOO_LARGE", {
        publicMessage: `The ${inputType} input exceeds the allowed size.`,
        diagnosticMessage: `${inputType} exceeded the configured ${maxBytes}-byte limit.`,
      });
    }
  }

  private async prepareBinary(
    raw: RawAIBinaryInput,
    inputType: "pdf" | "image",
    maxBytes: number,
  ): Promise<PreparedBinary> {
    if (!(raw?.bytes instanceof Uint8Array) && !raw?.adoptedFile) {
      throw new AIServiceError("AI_INPUT_INVALID", {
        publicMessage: "Uploaded binary data is invalid.",
        diagnosticMessage: "Binary intake did not provide bytes or a trusted staged file.",
      });
    }

    const declaredMime = inferredMime(raw, inputType);
    const sizeBytes = raw.adoptedFile?.sizeBytes ?? raw.bytes?.byteLength ?? 0;
    this.validateSize(sizeBytes, maxBytes, inputType === "pdf" ? "PDF" : "image");
    const displayName = sanitizeDisplayFilename(raw.originalFilename);
    const ownsOriginal = !raw.adoptedFile;
    const original = raw.adoptedFile ?? await this.temporaryFiles.stage(raw.bytes!);

    try {
      const normalized = normalizeAIBinaryMimeType(declaredMime);
      if (inputType === "pdf") {
        const mimeType = normalized ?? validateClaimedBinaryMime(declaredMime, "pdf");
        if (mimeType !== "application/pdf") {
          throw new AIServiceError("AI_INPUT_INVALID", {
            publicMessage: "The uploaded file type does not match the selected input mode.",
            diagnosticMessage: "Declared MIME type contradicted PDF input mode.",
          });
        }
        const detected = await inspectStagedMimeType(original.capability);
        assertDetectedMimeMatches("application/pdf", detected);
        return {
          staged: original,
          displayName,
          mimeType: "application/pdf",
          sha256: await sha256Capability(original.capability),
        };
      }

      if (normalized === "application/pdf") {
        throw new AIServiceError("AI_INPUT_INVALID", {
          publicMessage: "The uploaded file is a PDF, not an image.",
          diagnosticMessage: "Declared PDF MIME type was submitted in image mode.",
        });
      }
      if (!normalized && !CONVERTIBLE_IMAGE_MIMES.has(declaredMime)) {
        validateClaimedBinaryMime(declaredMime, "image");
      }

      // The byte signature is authoritative for direct raster formats. This also
      // tolerates stale browser MIME metadata (for example, an HEIC file reported
      // as image/jpeg) without weakening validation of the actual bytes.
      const detectedOriginal = await inspectStagedMimeType(original.capability);
      if (detectedOriginal === "application/pdf") {
        throw new AIServiceError("AI_INPUT_INVALID", {
          publicMessage: "The uploaded file is a PDF, not an image.",
          diagnosticMessage: "Binary signature identified a PDF while image mode was selected.",
        });
      }
      if (detectedOriginal === "image/jpeg" || detectedOriginal === "image/png" || detectedOriginal === "image/webp") {
        return {
          staged: original,
          displayName,
          mimeType: detectedOriginal,
          sha256: await sha256Capability(original.capability),
        };
      }

      let convertedBytes: Uint8Array;
      try {
        const originalBytes = await original.capability.readBytes();
        // Rasterize multi-frame/phone/camera formats to a stable first-frame image.
        // rotate() respects EXIF orientation so the vision model receives what the user sees.
        const pipeline = sharp(Buffer.from(originalBytes), {
          animated: false,
          failOn: "none",
          limitInputPixels: 120_000_000,
        }).rotate();
        let output = await pipeline.clone().png({ compressionLevel: 9 }).toBuffer();
        if (output.byteLength > maxBytes) {
          output = await pipeline.clone().jpeg({ quality: 94, mozjpeg: true }).toBuffer();
        }
        convertedBytes = new Uint8Array(output);
      } catch (error) {
        throw new AIServiceError("AI_INPUT_UNSUPPORTED", {
          publicMessage: "This image could not be decoded. Export it as JPEG, PNG, WebP, HEIC/HEIF, AVIF, TIFF, BMP, or GIF and try again.",
          diagnosticMessage: `Image transcoding failed for declared MIME ${declaredMime || "unknown"}.`,
          cause: error,
        });
      }
      this.validateSize(convertedBytes.byteLength, maxBytes, "image");
      const converted = await this.temporaryFiles.stage(convertedBytes);
      try {
        const detected = await inspectStagedMimeType(converted.capability);
        if (detected !== "image/png" && detected !== "image/jpeg") {
          throw new AIServiceError("AI_INPUT_INVALID", {
            publicMessage: "The converted image could not be validated.",
            diagnosticMessage: "Image transcoding did not produce a supported raster format.",
          });
        }
        let disposed = false;
        const staged: AIAdoptedBinaryFile = {
          sizeBytes: converted.sizeBytes,
          capability: converted.capability,
          dispose: async () => {
            if (disposed) return;
            disposed = true;
            await Promise.allSettled([converted.dispose(), original.dispose()]);
          },
        };
        return {
          staged,
          displayName,
          mimeType: detected,
          sha256: await sha256Capability(converted.capability),
        };
      } catch (error) {
        await converted.dispose().catch(() => {});
        throw error;
      }
    } catch (error) {
      if (ownsOriginal) await original.dispose().catch(() => {});
      throw error;
    }
  }

  async prepare(request: RawAIInput): Promise<PreparedAIInput> {
    const parsedRequest = rawAIInputSchema.safeParse(request);
    if (!parsedRequest.success) {
      throw new AIServiceError("AI_INPUT_INVALID", {
        publicMessage: "AI input is invalid.",
        diagnosticMessage: `Input request failed strict validation with ${parsedRequest.error.issues.length} issue(s).`,
      });
    }
    request = parsedRequest.data;

    if (request.kind === "text") {
      const normalized = normalizeAIText(request.text, this.limits.maxTextBytes);
      const source = {
        inputType: "text" as const,
        label: sanitizeSourceLabel(request.sourceLabel, "pasted text"),
      };
      const text = {
        kind: "text" as const,
        origin: "pasted_text" as const,
        mimeType: "text/plain" as const,
        source,
        ...normalized,
      };
      return {
        input: { kind: "text", text },
        contents: [{
          kind: "text",
          text: normalized.text,
          source,
          sizeBytes: normalized.sizeBytes,
          sha256: normalized.sha256,
        }],
        dispose: async () => {},
      };
    }

    if (request.kind === "pdf") {
      if (!request.file) {
        throw new AIServiceError("AI_INPUT_INVALID", {
          publicMessage: "PDF mode requires exactly one PDF.",
          diagnosticMessage: "PDF input did not include one file.",
        });
      }
      const prepared = await this.prepareBinary(
        request.file,
        "pdf",
        this.limits.maxPdfBytes,
      );
      const source = {
        inputType: "pdf" as const,
        label: sanitizeSourceLabel(request.file.sourceLabel, prepared.displayName),
      };
      const pageCount = await inspectPDFPageCount(prepared.staged.capability);
      const pdf: NormalizedPDFInput = {
        kind: "pdf",
        origin: "upload",
        displayName: prepared.displayName,
        mimeType: "application/pdf",
        sizeBytes: prepared.staged.sizeBytes,
        sha256: prepared.sha256,
        ownership: "owned_transient",
        fileSource: {
          kind: "staged_file",
          capability: prepared.staged.capability,
          ownership: "owned_transient",
        },
        source,
        ...(pageCount === undefined ? {} : { pageCount }),
      };
      const part: AIFilePart = {
        kind: "file",
        inputType: "pdf",
        mimeType: pdf.mimeType,
        fileSource: pdf.fileSource,
        source,
        sizeBytes: pdf.sizeBytes,
        sha256: pdf.sha256,
        ...(pageCount === undefined ? {} : { pageCount }),
      };
      return {
        input: { kind: "pdf", pdf },
        contents: [part],
        dispose: prepared.staged.dispose,
      };
    }

    if (request.kind === "image") {
      if (!Array.isArray(request.files) || request.files.length === 0) {
        throw new AIServiceError("AI_INPUT_INVALID", {
          publicMessage: "Image mode requires at least one image.",
          diagnosticMessage: "Image input did not contain a non-empty file array.",
        });
      }
      if (request.files.length > this.limits.maxImageCount) {
        throw new AIServiceError("AI_INPUT_TOO_LARGE", {
          publicMessage: "Too many images were supplied.",
          diagnosticMessage: `Image count exceeded the configured ${this.limits.maxImageCount} limit.`,
        });
      }

      for (const file of request.files) {
        if (!(file?.bytes instanceof Uint8Array) && !file?.adoptedFile) {
          throw new AIServiceError("AI_INPUT_INVALID", {
            publicMessage: "Uploaded image data is invalid.",
            diagnosticMessage: "An image intake item did not provide bytes or a trusted staged file.",
          });
        }
        this.validateSize(
          file.adoptedFile?.sizeBytes ?? file.bytes?.byteLength ?? 0,
          this.limits.maxImageBytes,
          "image",
        );
      }

      const staged: AIAdoptedBinaryFile[] = [];
      try {
        const images: NormalizedImageInput[] = [];
        const contents: AIContentPart[] = [];
        for (const [imageIndex, file] of request.files.entries()) {
          const prepared = await this.prepareBinary(
            file,
            "image",
            this.limits.maxImageBytes,
          );
          staged.push(prepared.staged);
          const source = {
            inputType: "image" as const,
            imageIndex,
            label: sanitizeSourceLabel(file.sourceLabel, prepared.displayName),
          };
          const image: NormalizedImageInput = {
            kind: "image",
            origin: "upload",
            displayName: prepared.displayName,
            mimeType: prepared.mimeType as NormalizedImageInput["mimeType"],
            sizeBytes: prepared.staged.sizeBytes,
            sha256: prepared.sha256,
            ownership: "owned_transient",
            fileSource: {
              kind: "staged_file",
              capability: prepared.staged.capability,
              ownership: "owned_transient",
            },
            source,
            imageIndex,
          };
          images.push(image);
          contents.push({
            kind: "file",
            inputType: "image",
            mimeType: image.mimeType,
            fileSource: image.fileSource,
            source,
            sizeBytes: image.sizeBytes,
            sha256: image.sha256,
          });
        }

        let disposed = false;
        return {
          input: { kind: "image", images },
          contents,
          dispose: async () => {
            if (disposed) return;
            await Promise.all(staged.map((file) => file.dispose()));
            disposed = true;
          },
        };
      } catch (error) {
        await Promise.all(staged.map((file) => file.dispose()));
        throw error;
      }
    }

    throw new AIServiceError("AI_INPUT_UNSUPPORTED", {
      publicMessage: "The selected AI input mode is not supported.",
      diagnosticMessage: "Input kind was outside pdf, image, or text.",
    });
  }

  async withPreparedInput<T>(
    request: RawAIInput,
    operation: (prepared: PreparedAIInput) => Promise<T>,
  ): Promise<T> {
    const prepared = await this.prepare(request);
    try {
      return await operation(prepared);
    } finally {
      await prepared.dispose();
    }
  }
}