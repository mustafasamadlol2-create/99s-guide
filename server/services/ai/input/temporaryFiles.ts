import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { AIServiceError } from "../errors.js";

export interface StagedAIFile {
  id: string;
  path: string;
  sizeBytes: number;
  dispose(): Promise<void>;
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

    let disposed = false;
    return {
      id,
      path,
      sizeBytes: bytes.byteLength,
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