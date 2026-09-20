import type { MCQExtractionProviderResponse } from "./schemas.js";

interface ParsedBlock {
  sourceOrdinal: number;
  question: string;
  options: string[];
  correctAnswer: "A" | "B" | "C" | "D" | null;
  uncertainties: string[];
}

const questionMarker = /^\s*(?:q(?:uestion)?\s*)?(\d{1,3})\s*(?:[.)、:：-]\s*|\s+)(.*)$/iu;
const optionMarker = /^\s*([A-D])\s*[).:：-]\s*(.*)$/iu;
const answerMarker = /^\s*(?:answer|correct\s+answer|ans|الإجابة)\s*[:：-]\s*(.+?)\s*$/iu;

function answerValue(value: string): { answer: ParsedBlock["correctAnswer"]; uncertainties: string[] } {
  const normalized = value.trim().toUpperCase();
  const multiple = normalized.match(/\b([A-D])\b(?:\s*(?:\+|\/|&|,|AND)\s*\b([A-D])\b)+/u);
  if (multiple) {
    return {
      answer: null,
      uncertainties: ["The source explicitly lists multiple answers; review is required."],
    };
  }
  const match = normalized.match(/\b([A-D])\b/u);
  return match
    ? { answer: match[1] as ParsedBlock["correctAnswer"], uncertainties: [] }
    : { answer: null, uncertainties: ["The source answer could not be interpreted as A, B, C, or D."] };
}

function parseBlock(lines: string[], sourceOrdinal: number): ParsedBlock | null {
  let question = "";
  const options: string[] = [];
  let answer: ParsedBlock["correctAnswer"] = null;
  const uncertainties: string[] = [];
  let currentOption = -1;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const option = line.match(optionMarker);
    if (option) {
      currentOption += 1;
      if (currentOption !== options.length) return null;
      options.push(option[2]!.trim());
      continue;
    }
    const answerLine = line.match(answerMarker);
    if (answerLine) {
      const parsed = answerValue(answerLine[1]!);
      answer = parsed.answer;
      uncertainties.push(...parsed.uncertainties);
      continue;
    }
    if (currentOption < 0) question = `${question} ${line}`.trim();
    else options[currentOption] = `${options[currentOption]} ${line}`.trim();
  }
  if (!question || options.length !== 4 || options.some((option) => !option)) return null;
  return { sourceOrdinal, question, options, correctAnswer: answer, uncertainties };
}

/**
 * Returns null unless every numbered block in the text is a complete,
 * contiguous four-option MCQ. A partial parse is never trusted.
 */
export function parseDeterministicMCQs(
  text: string,
  maxItems = 100,
): MCQExtractionProviderResponse | null {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const starts: Array<{ line: number; ordinal: number; firstText: string }> = [];
  for (let line = 0; line < lines.length; line += 1) {
    const match = lines[line]!.match(questionMarker);
    if (match) starts.push({ line, ordinal: Number(match[1]), firstText: match[2]!.trim() });
  }
  if (starts.length === 0 || starts[0]!.ordinal !== 1) return null;
  const parsed: ParsedBlock[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const current = starts[index]!;
    const next = starts[index + 1];
    const blockLines = [current.firstText, ...lines.slice(current.line + 1, next?.line ?? lines.length)];
    const block = parseBlock(blockLines, current.ordinal);
    if (!block) return null;
    parsed.push(block);
  }
  for (let index = 0; index < parsed.length; index += 1) {
    if (parsed[index]!.sourceOrdinal !== index + 1) return null;
  }
  const items = parsed.slice(0, maxItems).map((item) => ({
    sourceOrdinal: item.sourceOrdinal,
    question: item.question,
    options: item.options,
    correctAnswer: item.correctAnswer,
    hint: null,
    explanation: null,
    difficulty: null,
    source: {
      inputType: "text" as const,
      supportingExcerpt: item.question.slice(0, 300),
    },
    confidence: item.correctAnswer ? 1 : 0.8,
    uncertainties: item.uncertainties,
  }));
  return {
    items,
    skippedItems: [],
    truncated: parsed.length > maxItems,
    uncertainties: parsed.length > maxItems
      ? [`The deterministic source contained ${parsed.length} items; only ${maxItems} are supported.`]
      : [],
  };
}