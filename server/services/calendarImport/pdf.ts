import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_FALLBACK_PAGES = 500;

export async function getPdfPageCount(path: string): Promise<number | null> {
  try {
    const result = await execFileAsync("pdfinfo", [path], {
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    });
    const match = result.stdout.match(/^Pages:\s+(\d+)$/mu);
    const pages = match ? Number(match[1]) : NaN;
    if (Number.isSafeInteger(pages) && pages > 0 && pages <= MAX_FALLBACK_PAGES) return pages;
  } catch {
    // Fall through to the bounded structural fallback.
  }
  try {
    const bytes = await readFile(path);
    const text = bytes.toString("latin1");
    const pages = [...text.matchAll(/\/Type\s*\/Page(?:\s|\/|>)/gu)].length;
    return pages > 0 && pages <= MAX_FALLBACK_PAGES ? pages : null;
  } catch {
    return null;
  }
}