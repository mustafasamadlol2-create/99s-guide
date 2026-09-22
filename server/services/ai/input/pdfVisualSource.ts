import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import {
  getDocument,
  OPS,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { AIServiceError } from "../errors.js";
import type {
  AIPdfSourceReference,
  AIStagedFileCapability,
  AIVisualPDFPage,
} from "./contracts.js";
import { sha256Bytes } from "./hash.js";
import { detectAIBinaryMimeType } from "./validators.js";

export const DEFAULT_MAX_VISUAL_PAGES = 20;
export const PDF_RENDER_DPI = 144;
export const PDF_RENDER_MAX_DIMENSION = 4096;
export const PDF_RENDER_MAX_PIXELS = PDF_RENDER_MAX_DIMENSION ** 2;

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
    throwIfAborted(signal);
    const document = await loadPDFDocument(capability);
    const pages = new Set<number>();
    try {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        throwIfAborted(signal);
        const page = await document.getPage(pageNumber);
        const operatorList = await page.getOperatorList();
        if (operatorList.fnArray.some((operator) =>
          operator === OPS.paintImageMaskXObject ||
          operator === OPS.paintImageXObject ||
          operator === OPS.paintImageXObjectRepeat
        )) {
          pages.add(pageNumber);
        }
        page.cleanup();
      }
    } finally {
      await document.cleanup();
    }
    return [...pages].sort((left, right) => left - right);
  } catch (error) {
    if (signal?.aborted) throw error;
    return [];
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

async function renderPage(
  document: PDFDocumentProxy,
  page: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  throwIfAborted(signal);
  let pdfPage: PDFPageProxy | undefined;
  try {
    pdfPage = await document.getPage(page);
    const initialViewport = pdfPage.getViewport({ scale: PDF_RENDER_DPI / 72 });
    const scale = Math.min(
      1,
      PDF_RENDER_MAX_DIMENSION / initialViewport.width,
      PDF_RENDER_MAX_DIMENSION / initialViewport.height,
    );
    const viewport = scale === 1
      ? initialViewport
      : pdfPage.getViewport({ scale: (PDF_RENDER_DPI / 72) * scale });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    if (
      width <= 0 ||
      height <= 0 ||
      width > PDF_RENDER_MAX_DIMENSION ||
      height > PDF_RENDER_MAX_DIMENSION ||
      width * height > PDF_RENDER_MAX_PIXELS
    ) {
      throw new Error(`Rendered PDF page dimensions exceeded the ${PDF_RENDER_MAX_DIMENSION}px bound.`);
    }
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    await pdfPage.render({
      canvas: canvas as never,
      canvasContext: context as never,
      viewport,
    }).promise;
    const bytes = new Uint8Array(canvas.toBuffer("image/png"));
    if (detectAIBinaryMimeType(bytes) !== "image/png") {
      throw new Error("PDF renderer did not produce a valid PNG.");
    }
    return bytes;
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
    throw new AIServiceError("AI_MEDIA_PROCESSING_FAILED", {
      publicMessage: "The AI provider could not prepare a visual page from this PDF.",
      diagnosticMessage: `Portable PDF page rendering failed for page ${page}.`,
      cause: error,
      retryable: true,
    });
  } finally {
    pdfPage?.cleanup();
  }
}

async function loadPDFDocument(capability: AIStagedFileCapability): Promise<PDFDocumentProxy> {
  try {
    const bytes = await capability.readBytes();
    return await getDocument({
      data: bytes,
      useSystemFonts: false,
      stopAtErrors: true,
    }).promise;
  } catch (error) {
    throw new AIServiceError("AI_MEDIA_PROCESSING_FAILED", {
      publicMessage: "The AI provider could not prepare this PDF for visual analysis.",
      diagnosticMessage: "Portable PDF rendering could not load the staged PDF.",
      cause: error,
      retryable: true,
    });
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

  const document = await loadPDFDocument(capability);
  const pages: AIVisualPDFPage[] = [];
  try {
    for (let page = startPage; page <= endPage; page += 1) {
      const visualPage = await renderPDFPage(document, source, page, options.signal);
      pages.push(visualPage);
    }
    return pages;
  } finally {
    await document.cleanup();
  }
}

async function renderPDFPage(
  document: PDFDocumentProxy,
  source: AIPdfSourceReference,
  page: number,
  signal?: AbortSignal,
): Promise<AIVisualPDFPage> {
  const bytes = await renderPage(document, page, signal);
  return {
    kind: "visual_page",
    inputType: "pdf",
    page,
    mimeType: "image/png",
    bytes,
    sizeBytes: bytes.byteLength,
    sha256: sha256Bytes(bytes),
    source: { ...source, page },
  };
}

export async function forEachRenderedPDFPage(
  capability: AIStagedFileCapability,
  source: AIPdfSourceReference,
  pageCount: number | undefined,
  options: {
    startPage?: number;
    endPage?: number;
    maxPages?: number;
    signal?: AbortSignal;
  },
  visit: (page: AIVisualPDFPage) => Promise<void>,
): Promise<void> {
  const maxPages = Math.min(
    options.maxPages ?? DEFAULT_MAX_VISUAL_PAGES,
    DEFAULT_MAX_VISUAL_PAGES,
  );
  const startPage = Math.max(1, options.startPage ?? 1);
  const requestedEnd = options.endPage ?? pageCount ?? startPage;
  if (pageCount !== undefined && startPage > pageCount) {
    throw new AIServiceError("AI_INPUT_INVALID", {
      publicMessage: "The requested PDF page range is invalid.",
      diagnosticMessage: `Requested PDF page ${startPage} exceeds the ${pageCount}-page document.`,
    });
  }
  const endPage = Math.min(requestedEnd, pageCount ?? requestedEnd);
  if (endPage < startPage) return;

  const document = await loadPDFDocument(capability);
  try {
    for (let windowStart = startPage; windowStart <= endPage; windowStart += maxPages) {
      const windowEnd = Math.min(endPage, windowStart + maxPages - 1);
      for (let page = windowStart; page <= windowEnd; page += 1) {
        await visit(await renderPDFPage(document, source, page, options.signal));
      }
    }
  } finally {
    await document.cleanup();
  }
}