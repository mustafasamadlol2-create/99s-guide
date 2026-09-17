import { randomUUID } from "node:crypto";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { AIServiceError } from "../errors.js";
import type { AIStagedFileCapability } from "./contracts.js";

export interface StagedAIFile {
  id: string;
  path: string;
  sizeBytes: number;
  capability: AIStagedFileCapability;
  dispose(): Promise<void>;
}

const trustedCapabilities = new WeakSet<object>();

export function isTrustedAIStagedFileCapability(
  value: unknown,
): value is AIStagedFileCapability {
  return typeof value === "object" && value !== null && trustedCapabilities.has(value);
}

export class AITemporaryFileManager {
  readonly root: string;

  constructor(root = join(tmpdir(), "99-guide-ai-inputs")) {
    this.root = resolve(root);
  }

  private owns(path: string): boolean {
    const candidate = resolve(path);
    const rel = relative(this.root, candidate);
    return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
  }

  async stage(bytes: Uint8Array): Promise<StagedAIFile> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const path = join(this.root, id);
    if (!this.owns(path)) {
      throw new AIServiceError("AI_INPUT_STAGE_FAILED", {
        publicMessage: "The AI input could not be staged.",
        diagnosticMessage: "Generated staging path escaped the configured temporary root.",
      });
    }

    try {
      await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    } catch (error) {
      throw new AIServiceError("AI_INPUT_STAGE_FAILED", {
        publicMessage: "The AI input could not be staged.",
        diagnosticMessage: "Writing a generated temporary file failed.",
        cause: error,
      });
    }

    return this.createOwnedFile(path, bytes.byteLength, id);
  }

  async adopt(path: string): Promise<StagedAIFile> {
    const resolvedPath = resolve(path);
    if (!this.owns(resolvedPath)) {
      throw new AIServiceError("AI_INPUT_STAGE_FAILED", {
        publicMessage: "The AI input could not be adopted.",
        diagnosticMessage: "Adoption path failed the temporary-root ownership check.",
      });
    }
    let fileStats;
    try {
      fileStats = await stat(resolvedPath);
    } catch (error) {
      throw new AIServiceError("AI_INPUT_STAGE_FAILED", {
        publicMessage: "The AI input could not be adopted.",
        diagnosticMessage: "The uploaded temporary file could not be inspected.",
        cause: error,
      });
    }
    if (!fileStats.isFile() || !Number.isSafeInteger(fileStats.size) || fileStats.size <= 0) {
      throw new AIServiceError("AI_INPUT_INVALID", {
        publicMessage: "Uploaded binary data is invalid.",
        diagnosticMessage: "Adopted temporary input was not a non-empty regular file.",
      });
    }
    return this.createOwnedFile(resolvedPath, fileStats.size, resolvedPath.split(sep).pop() ?? randomUUID());
  }

  private createOwnedFile(path: string, sizeBytes: number, id: string): StagedAIFile {
    let disposed = false;
    const capability: AIStagedFileCapability = {
      sizeBytes,
      readBytes: async () => {
        if (disposed) throw new AIServiceError("AI_INPUT_CLEANUP_FAILED", {
          publicMessage: "The staged AI input is no longer available.",
          diagnosticMessage: "A staged capability was read after disposal.",
        });
        const { readFile } = await import("node:fs/promises");
        return new Uint8Array(await readFile(path));
      },
      withPath: async <T>(operation: (path: string) => Promise<T>) => {
        if (disposed) throw new AIServiceError("AI_INPUT_CLEANUP_FAILED", {
          publicMessage: "The staged AI input is no longer available.",
          diagnosticMessage: "A staged capability was used after disposal.",
        });
        return operation(path);
      },
    };
    trustedCapabilities.add(capability);
    return {
      id,
      path,
      sizeBytes,
      capability,
      dispose: async () => {
        if (disposed) return;
        if (!this.owns(path)) {
          throw new AIServiceError("AI_INPUT_CLEANUP_FAILED", {
            publicMessage: "Temporary AI input cleanup failed.",
            diagnosticMessage: "Cleanup path failed the temporary-root ownership check.",
          });
        }
        try {
          await unlink(path);
          disposed = true;
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "ENOENT"
          ) {
            disposed = true;
            return;
          }
          throw new AIServiceError("AI_INPUT_CLEANUP_FAILED", {
            publicMessage: "Temporary AI input cleanup failed.",
            diagnosticMessage: "Removing an owned temporary file failed.",
            cause: error,
          });
        }
      },
    };
  }
}