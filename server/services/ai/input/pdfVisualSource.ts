import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { AIServiceError } from "../errors.js";
import type {
  AIPdfSourceReference,
  AIStagedFileCapability,
  AIVisualPDFPage,
} from "./contracts.js";
import { sha256Bytes } from "./hash.js";
import { detectAIBinaryMimeType } from "./validators.js";

const execFile = promisify(execFileCallback);
export const DEFAULT_MAX_VISUAL_PAGES = 20;

export async function inspectPDFPageCount(
  capability: AIStagedFileCapability,
): Promise<number | undefined> {
  try {
    const bytes = await capability.readBytes();
    const document = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const count = document.getPageCount();
    return count > 0 ? count : undefined;
  } catch {
    // Intake remains compatible with previously accepted PDFs. Providers will
    // still receive the original bytes and can classify malformed documents.
    return undefined;
  }
}

export async function inspectPDFImagePages(
  capability: AIStagedFileCapability,
  signal?: AbortSignal,
): Promise<number[]> {
  try {
    const output = await capability.withPath((inputPath) =>
      execFile("pdfimages", ["-list", inputPath], {
        signal,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      }),
    );
    const pages = new Set<number>();
    for (const line of output.stdout.split(/\r?\n/u)) {
      const match = line.match(/^\s*(\d+)\s+\d+\s+/u);
      if (match) pages.add(Number(match[1]));
    }
    return [...pages].sort((left, right) => left - right);
  } catch {
    return [];
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

async function renderPage(
  capability: AIStagedFileCapability,
  page: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  throwIfAborted(signal);
  const root = await mkdtemp(join(tmpdir(), "99-guide-ai-pdf-"));
  const outputPrefix = join(root, "page");
  try {
    await capability.withPath(async (inputPath) => {
      await execFile(
        "pdftoppm",
        ["-png", "-r", "144", "-f", String(page), "-l", String(page), "-singlefile", inputPath, outputPrefix],
        { signal, timeout: 30_000, maxBuffer: 1024 * 1024 },
      );
    });
    const bytes = new Uint8Array(await readFile(`${outputPrefix}.png`));
    if (detectAIBinaryMimeType(bytes) !== "image/png") {
      throw new Error("PDF renderer did not produce a valid PNG.");
    }
    return bytes;
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
    throw new AIServiceError("AI_MEDIA_PROCESSING_FAILED", {
      publicMessage: "The AI provider could not prepare a visual page from this PDF.",
      diagnosticMessage: `Bounded PDF page rendering failed for page ${page}.`,
      cause: error,
      retryable: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

export async function renderPDFPages(
  capability: AIStagedFileCapability,
  source: AIPdfSourceReference,
  pageCount: number | undefined,
  options: {
    startPage?: number;
    endPage?: number;
    maxPages?: number;
    signal?: AbortSignal;
  } = {},
): Promise<AIVisualPDFPage[]> {
  const maxPages = Math.min(
    options.maxPages ?? DEFAULT_MAX_VISUAL_PAGES,
    DEFAULT_MAX_VISUAL_PAGES,
  );
  const startPage = Math.max(1, options.startPage ?? 1);
  const requestedEnd = options.endPage ?? pageCount ?? startPage;
  const endPage = Math.min(requestedEnd, startPage + maxPages - 1);
  if (endPage < startPage) return [];
  if (pageCount !== undefined && startPage > pageCount) {
    throw new AIServiceError("AI_INPUT_INVALID", {
      publicMessage: "The requested PDF page range is invalid.",
      diagnosticMessage: `Requested PDF page ${startPage} exceeds the ${pageCount}-page document.`,
    });
  }

  const pages: AIVisualPDFPage[] = [];
  for (let page = startPage; page <= endPage; page += 1) {
    const bytes = await renderPage(capability, page, options.signal);
    pages.push({
      kind: "visual_page",
      inputType: "pdf",
      page,
      mimeType: "image/png",
      bytes,
      sizeBytes: bytes.byteLength,
      sha256: sha256Bytes(bytes),
      source: { ...source, page },
    });
  }
  return pages;
}