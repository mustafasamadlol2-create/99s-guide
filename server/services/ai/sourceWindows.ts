import type { AIContentPart } from "./input/contracts.js";

export interface AISourceWindow {
  contents: AIContentPart[];
  instruction: string;
}

export function createBinarySourceWindows(
  contents: AIContentPart[],
  options: { pdfPagesPerWindow?: number; imagesPerWindow?: number } = {},
): AISourceWindow[] {
  const pdf = contents.length === 1 && contents[0]?.kind === "file" && contents[0].inputType === "pdf"
    ? contents[0]
    : null;
  if (pdf) {
    const pagesPerWindow = Math.max(1, options.pdfPagesPerWindow ?? 4);
    const pageCount = pdf.pageCount;
    if (!pageCount || pageCount <= pagesPerWindow) {
      return [{
        contents,
        instruction: pageCount
          ? `Use the complete PDF source covering pages 1-${pageCount}.`
          : "Use the complete PDF source and inspect every available page.",
      }];
    }
    const windows: AISourceWindow[] = [];
    for (let start = 1; start <= pageCount; start += pagesPerWindow) {
      const end = Math.min(pageCount, start + pagesPerWindow - 1);
      windows.push({
        contents,
        instruction: `Inspect only PDF pages ${start}-${end} for this bounded pass. Return source page numbers for every item and do not extract content from pages outside this range.`,
      });
    }
    return windows;
  }

  if (contents.length > 0 && contents.every((part) => part.kind === "file" && part.inputType === "image")) {
    const imagesPerWindow = Math.max(1, options.imagesPerWindow ?? 4);
    const windows: AISourceWindow[] = [];
    for (let start = 0; start < contents.length; start += imagesPerWindow) {
      const end = Math.min(contents.length, start + imagesPerWindow);
      windows.push({
        contents: contents.slice(start, end),
        instruction: `Inspect uploaded image indexes ${start}-${end - 1} in this bounded pass. Preserve each sourceImageIndex/imageIndex exactly and do not infer content from images outside this pass.`,
      });
    }
    return windows;
  }

  return [{ contents, instruction: "Use the complete submitted source." }];
}
