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
import { sanitizeDisplayFilename, sanitizeSourceLabel } from "./mime.js";
import { normalizeAIText } from "./normalizeText.js";
import { rawAIInputSchema } from "./schemas.js";
import { AITemporaryFileManager } from "./temporaryFiles.js";
import { inspectPDFPageCount } from "./pdfVisualSource.js";
import {
  assertDetectedMimeMatches,
  inspectStagedMimeType,
  validateClaimedBinaryMime,
} from "./validators.js";

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
    const mimeType = validateClaimedBinaryMime(raw.claimedMimeType, inputType);
    const sizeBytes = raw.adoptedFile?.sizeBytes ?? raw.bytes?.byteLength ?? 0;
    this.validateSize(sizeBytes, maxBytes, inputType === "pdf" ? "PDF" : "image");
    const displayName = sanitizeDisplayFilename(raw.originalFilename);
    const ownsStaged = !raw.adoptedFile;
    const staged = raw.adoptedFile ?? await this.temporaryFiles.stage(raw.bytes!);
    try {
      const detected = await inspectStagedMimeType(staged.capability);
      assertDetectedMimeMatches(mimeType, detected);
      return {
        staged,
        displayName,
        mimeType,
        sha256: await sha256Capability(staged.capability),
      };
    } catch (error) {
      if (ownsStaged) await staged.dispose();
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
        validateClaimedBinaryMime(file.claimedMimeType, "image");
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