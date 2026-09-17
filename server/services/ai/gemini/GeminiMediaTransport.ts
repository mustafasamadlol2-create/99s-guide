import { AIServiceError } from "../errors.js";
import type { AIContentPart, AIFilePart, AIStagedFileCapability } from "../input/contracts.js";
import { isTrustedAIStagedFileCapability } from "../input/temporaryFiles.js";
import { GeminiFilesManager, type GeminiFileReference } from "./GeminiFilesManager.js";
import type { GeminiMediaConfig } from "./config.js";

export interface AIExistingResourceResolver {
  resolve(resourceId: string): Promise<{
    capability: AIStagedFileCapability;
    mimeType: string;
    sizeBytes: number;
  }>;
}

export interface GeminiTransportResult {
  contents: unknown;
  transport: "inline" | "files_api";
  mediaCount: number;
  cleanup(): Promise<void>;
}

function raceAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new Error("aborted"));
    };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export class GeminiMediaTransport {
  constructor(
    private readonly filesManager: GeminiFilesManager | undefined,
    private readonly config: GeminiMediaConfig,
    private readonly resolver?: AIExistingResourceResolver,
  ) {}

  async prepare(contents: AIContentPart[], signal?: AbortSignal): Promise<GeminiTransportResult> {
    if (contents.every((part) => part.kind === "text")) {
      return {
        contents: [{ role: "user", parts: contents.map((part) => ({ text: part.text })) }],
        transport: "inline",
        mediaCount: 0,
        cleanup: async () => {},
      };
    }
    if (contents.some((part) => part.kind === "text")) {
      throw new AIServiceError("AI_INPUT_INVALID", {
        publicMessage: "Only one AI source mode may be submitted.",
        diagnosticMessage: "Mixed text and binary content parts are not supported.",
      });
    }
    const binary = contents as AIFilePart[];
    const isPdf = binary[0]?.inputType === "pdf";
    const totalBytes = binary.reduce((sum, part) => sum + part.sizeBytes, 0);
    const useFiles = isPdf || totalBytes > this.config.inlineImageMaxTotalBytes;
    if (!useFiles) {
      const parts = await Promise.all(binary.map(async (part) => ({
        inlineData: {
          data: Buffer.from(await raceAbort(
            this.resolveCapability(part).then((capability) => capability.readBytes()),
            signal,
          )).toString("base64"),
          mimeType: part.mimeType,
        },
      })));
      return { contents: [{ role: "user", parts }], transport: "inline", mediaCount: binary.length, cleanup: async () => {} };
    }
    const uploaded: GeminiFileReference[] = [];
    if (!this.filesManager) {
      throw new AIServiceError("AI_MEDIA_UPLOAD_FAILED", {
        publicMessage: "The AI media provider is unavailable.",
        diagnosticMessage: "Gemini Files API client is not configured.",
      });
    }
    try {
      const parts = [];
      for (const part of binary) {
        const file = await this.filesManager.uploadAndActivate(
          await raceAbort(this.resolveCapability(part), signal),
          part.mimeType,
          signal,
        );
        uploaded.push(file);
        parts.push({ fileData: { fileUri: file.uri, mimeType: file.mimeType } });
      }
      return {
        contents: [{ role: "user", parts }],
        transport: "files_api",
        mediaCount: binary.length,
        cleanup: async () => {
          await this.filesManager!.cleanupNames(uploaded.map((file) => file.name));
        },
      };
    } catch (error) {
      await this.filesManager.cleanupNames(uploaded.map((file) => file.name)).catch(() => {});
      throw error;
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
          diagnosticMessage: "The staged capability was not trusted or did not match validated size.",
        });
      }
      return part.fileSource.capability;
    }
    if (!this.resolver) {
      throw new AIServiceError("AI_MEDIA_RESOLUTION_FAILED", {
        publicMessage: "The AI source resource could not be resolved.",
        diagnosticMessage: "No trusted existing-resource resolver was configured.",
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
        diagnosticMessage: "Resolved resource MIME did not match validated source MIME.",
      });
    }
    return resolved.capability;
  }
}