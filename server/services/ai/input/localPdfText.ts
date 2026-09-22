import type { AIContentPart, AIPdfFilePart, AIStagedFileCapability } from "./contracts.js";
import { isTrustedAIStagedFileCapability } from "./temporaryFiles.js";
import {
  extractPDFLayoutPages,
  extractPDFPageProfiles,
  type PDFLayoutPage,
  type PDFTextPageProfile,
} from "./pdfVisualSource.js";

export interface LocalPdfTextResult {
  profiles: PDFTextPageProfile[];
  text: string;
  richPageRatio: number;
  totalTextCharacters: number;
}

function textCharacterCount(value: string): number {
  return value.replace(/\s/gu, "").length;
}

function stagedPdfCapability(contents: AIContentPart[]): { part: AIPdfFilePart; capability: AIStagedFileCapability } | null {
  const pdfs = contents.filter((part): part is AIPdfFilePart => part.kind === "file" && part.inputType === "pdf");
  if (pdfs.length !== 1) return null;
  const part = pdfs[0]!;
  const source = part.fileSource;
  if (source.kind !== "staged_file") return null;
  if (!isTrustedAIStagedFileCapability(source.capability)) return null;
  return { part, capability: source.capability };
}

/**
 * Reads the PDF's embedded text layer locally without a network call. This is
 * intentionally only a fast-path. Scanner-only PDFs return a low richPageRatio
 * and callers can fall back to Cloudflare visual OCR.
 */
export async function readLocalPdfText(
  contents: AIContentPart[],
  signal?: AbortSignal,
): Promise<LocalPdfTextResult | null> {
  const staged = stagedPdfCapability(contents);
  if (!staged) return null;
  try {
    const profiles = await extractPDFPageProfiles(staged.capability, signal);
    if (!profiles.length) return null;
    const rich = profiles.filter((profile) => textCharacterCount(profile.text) >= 80).length;
    const text = profiles
      .filter((profile) => profile.text.trim())
      .map((profile) => `[PDF page ${profile.page}]\n${profile.text.trim()}`)
      .join("\n\n");
    return {
      profiles,
      text,
      richPageRatio: rich / profiles.length,
      totalTextCharacters: textCharacterCount(text),
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

export function hasHealthyLocalPdfText(result: LocalPdfTextResult | null): result is LocalPdfTextResult {
  return Boolean(result && result.totalTextCharacters >= 600 && result.richPageRatio >= 0.55);
}


export async function readLocalPdfLayout(
  contents: AIContentPart[],
  signal?: AbortSignal,
): Promise<PDFLayoutPage[] | null> {
  const staged = stagedPdfCapability(contents);
  if (!staged) return null;
  try {
    const pages = await extractPDFLayoutPages(staged.capability, signal);
    return pages.length ? pages : null;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}
