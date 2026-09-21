import type { AIContentPart, AITextPart } from "../input/contracts.js";
import { sha256Text } from "../input/hash.js";

const marker = /^\s*(?:q(?:uestion)?\s*)?(\d{1,4})\s*(?:[.)、:：-]\s*|\s+).+$/iu;

export interface MCQSourceBlock {
  ordinal: number;
  text: string;
}

export interface MCQExtractionPlan {
  blocks: MCQSourceBlock[];
  contentsForRange(start: number, count: number): AIContentPart[];
}

function textPartFor(text: string, source: AITextPart["source"]): AITextPart {
  return {
    kind: "text",
    text,
    source,
    sizeBytes: new TextEncoder().encode(text).byteLength,
    sha256: sha256Text(text),
  };
}

export function planNumberedMCQExtraction(contents: AIContentPart[]): MCQExtractionPlan | null {
  const part = contents.length === 1 && contents[0]?.kind === "text" ? contents[0] : null;
  if (!part) return null;
  const lines = part.text.replace(/\r\n?/gu, "\n").split("\n");
  const starts: Array<{ line: number; ordinal: number }> = [];
  for (let line = 0; line < lines.length; line += 1) {
    const match = lines[line]!.match(marker);
    if (match) starts.push({ line, ordinal: Number(match[1]) });
  }
  if (starts.length < 2) return null;
  const blocks = starts.map((start, index) => ({
    ordinal: start.ordinal,
    text: lines.slice(start.line, starts[index + 1]?.line ?? lines.length).join("\n").trim(),
  }));
  if (new Set(blocks.map((block) => block.ordinal)).size !== blocks.length) return null;
  for (let index = 1; index < blocks.length; index += 1) {
    if (blocks[index]!.ordinal <= blocks[index - 1]!.ordinal) return null;
  }
  return {
    blocks,
    contentsForRange: (start, count) => [
      textPartFor(
        blocks.slice(start, start + count).map((block) => block.text).join("\n\n"),
        part.source,
      ),
    ],
  };
}

export function contiguousIndexRanges(indexes: number[]): Array<{ start: number; count: number }> {
  if (!indexes.length) return [];
  const ranges: Array<{ start: number; count: number }> = [];
  let start = indexes[0]!;
  let previous = start;
  for (const index of indexes.slice(1)) {
    if (index === previous + 1) {
      previous = index;
      continue;
    }
    ranges.push({ start, count: previous - start + 1 });
    start = index;
    previous = index;
  }
  ranges.push({ start, count: previous - start + 1 });
  return ranges;
}