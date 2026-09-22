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
export const PDF_PROFILE_CONCURRENCY = 6;

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

export interface PDFTextPageProfile {
  page: number;
  text: string;
  imageCount: number;
}

function textFromPageItems(items: unknown[]): string {
  const tokens: Array<{ text: string; x: number; y: number; width: number }> = [];
  const fallback: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item)) continue;
    const record = item as { str?: unknown; transform?: unknown; hasEOL?: unknown };
    const value = typeof record.str === "string" ? record.str.replace(/\s+/gu, " ").trim() : "";
    if (!value) continue;
    fallback.push(value + (record.hasEOL === true ? "\n" : ""));
    const transform = Array.isArray(record.transform) ? record.transform : null;
    const x = transform && Number.isFinite(Number(transform[4])) ? Number(transform[4]) : Number.NaN;
    const y = transform && Number.isFinite(Number(transform[5])) ? Number(transform[5]) : Number.NaN;
    const width = Number.isFinite(Number((record as { width?: unknown }).width)) ? Math.max(0, Number((record as { width?: unknown }).width)) : 0;
    if (Number.isFinite(x) && Number.isFinite(y)) tokens.push({ text: value, x, y, width });
  }
  if (tokens.length === 0) {
    return fallback.join(" ").replace(/\s*\n\s*/gu, "\n").replace(/[ \t]+/gu, " ").trim();
  }

  const rows: Array<{ y: number; tokens: Array<{ text: string; x: number; width: number }> }> = [];
  for (const token of tokens.sort((a, b) => b.y - a.y || a.x - b.x)) {
    let row = rows.find((candidate) => Math.abs(candidate.y - token.y) <= 2.5);
    if (!row) {
      row = { y: token.y, tokens: [] };
      rows.push(row);
    }
    row.tokens.push({ text: token.text, x: token.x, width: token.width });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      const ordered = row.tokens.sort((a, b) => a.x - b.x);
      let line = "";
      let previousRight: number | null = null;
      for (const token of ordered) {
        if (previousRight !== null) {
          const gap = token.x - previousRight;
          line += gap >= 22 ? " | " : gap >= 8 ? "  " : " ";
        }
        line += token.text;
        previousRight = token.x + token.width;
      }
      return line.trim();
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

export async function extractPDFPageProfiles(
  capability: AIStagedFileCapability,
  signal?: AbortSignal,
): Promise<PDFTextPageProfile[]> {
  throwIfAborted(signal);
  const document = await loadPDFDocument(capability);
  const profiles: PDFTextPageProfile[] = [];
  try {
    // Profile pages in small local batches. We still inspect image operators on
    // every page so mixed PDFs do not lose diagrams/tables merely because a page
    // also has a healthy text layer. The batching removes the old fully-serial
    // CPU path without sacrificing visual completeness.
    for (let start = 1; start <= document.numPages; start += PDF_PROFILE_CONCURRENCY) {
      throwIfAborted(signal);
      const pageNumbers = Array.from(
        { length: Math.min(PDF_PROFILE_CONCURRENCY, document.numPages - start + 1) },
        (_, index) => start + index,
      );
      const batch = await Promise.all(pageNumbers.map(async (pageNumber): Promise<PDFTextPageProfile> => {
        throwIfAborted(signal);
        const page = await document.getPage(pageNumber);
        try {
          const [textContent, operatorList] = await Promise.all([
            page.getTextContent(),
            page.getOperatorList(),
          ]);
          const text = textFromPageItems(textContent.items as unknown[]);
          const imageCount = operatorList.fnArray.reduce((count, operator) => count + (
            operator === OPS.paintImageMaskXObject ||
            operator === OPS.paintImageXObject ||
            operator === OPS.paintImageXObjectRepeat
              ? 1
              : 0
          ), 0);
          return { page: pageNumber, text, imageCount };
        } finally {
          page.cleanup();
        }
      }));
      profiles.push(...batch);
    }
    return profiles;
  } finally {
    await document.cleanup();
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

export async function renderSelectedPDFPages(
  capability: AIStagedFileCapability,
  source: AIPdfSourceReference,
  pageNumbers: number[],
  signal?: AbortSignal,
): Promise<AIVisualPDFPage[]> {
  const requested = [...new Set(pageNumbers)]
    .filter((page) => Number.isInteger(page) && page > 0)
    .sort((a, b) => a - b);
  if (requested.length === 0) return [];
  const document = await loadPDFDocument(capability);
  try {
    const pages: AIVisualPDFPage[] = [];
    for (const page of requested) {
      throwIfAborted(signal);
      if (page > document.numPages) continue;
      pages.push(await renderPDFPage(document, source, page, signal));
    }
    return pages;
  } finally {
    await document.cleanup();
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