import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

export async function getPdfPageCount(path: string): Promise<number | null> {
  try {
    const document = await PDFDocument.load(await readFile(path), {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const pages = document.getPageCount();
    return Number.isSafeInteger(pages) && pages > 0 ? pages : null;
  } catch {
    return null;
  }
}