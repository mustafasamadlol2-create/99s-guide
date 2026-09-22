import type { MCQExtractionProviderResponse } from "./schemas.js";

interface ParsedBlock {
  sourceOrdinal: number;
  question: string;
  options: string[];
  correctAnswer: "A" | "B" | "C" | "D" | null;
  uncertainties: string[];
}

const questionMarker = /^\s*(?:q(?:uestion)?\s*[iIl|]?\s*)?(\d{1,3})\s*(?:[.)、:：\/-]\s*|\s+)(.*)$/iu;
const optionMarker = /^\s*(?:\(([A-D])\)|([A-D])\s*[).:：\/-]|([1-4])\s*[).:：\/-])\s*(.*)$/iu;
const answerMarker = /^\s*(?:answer|correct\s+answer|correct|ans|key|الإجابة)\s*(?:[:：\/-]\s*)?(.+?)\s*$/iu;

function normalizeMarkdownMarkerLine(value: string): string {
  return value
    .replace(/\\([.):：-])/gu, "$1")
    .replace(/\*\*|__/gu, "")
    .replace(/^\s*[-+*]\s+(?=(?:\(?[A-D1-4]\)?\s*[).:：-]|(?:answer|correct|ans|key)\b))/iu, "")
    .trimEnd();
}

function optionLabel(value: string | undefined): "A" | "B" | "C" | "D" | null {
  if (!value) return null;
  const normalized = value.toUpperCase();
  if (/^[A-D]$/u.test(normalized)) return normalized as "A" | "B" | "C" | "D";
  return ({ "1": "A", "2": "B", "3": "C", "4": "D" } as const)[normalized as "1" | "2" | "3" | "4"] ?? null;
}

function answerValue(value: string): { answer: ParsedBlock["correctAnswer"]; uncertainties: string[] } {
  const normalized = value.trim().toUpperCase().replace(/[()[\].:：]/gu, " ");
  const tokens = normalized.match(/\b(?:OPTION\s*)?([A-D1-4])\b/gu) ?? [];
  const values = tokens.map((token) => token.replace(/^OPTION\s*/u, ""));
  const distinct = [...new Set(values)];
  if (distinct.length !== 1 || !/^[A-D1-4]$/u.test(distinct[0] ?? "")) {
    return {
      answer: null,
      uncertainties: [
        distinct.length > 1
          ? "The source explicitly lists multiple or ambiguous answers; review is required."
          : "The source answer could not be interpreted as a single option.",
      ],
    };
  }
  const answer = optionLabel(distinct[0]);
  return answer
    ? { answer, uncertainties: [] }
    : { answer: null, uncertainties: ["The source answer could not be interpreted as A, B, C, or D."] };
}

function parseBlock(lines: string[], sourceOrdinal: number): ParsedBlock | null {
  const normalizedLines = lines.map((line) => normalizeMarkdownMarkerLine(line).trim());
  let question = "";
  const options: string[] = [];
  let answer: ParsedBlock["correctAnswer"] = null;
  const uncertainties: string[] = [];
  let currentOption = -1;

  const firstFollowingExplicitOption = (from: number): "A" | "B" | "C" | "D" | null => {
    for (let index = from + 1; index < normalizedLines.length; index += 1) {
      const match = normalizedLines[index]!.match(optionMarker);
      if (!match) continue;
      return optionLabel(match[1] ?? match[2] ?? match[3]);
    }
    return null;
  };

  for (let index = 0; index < normalizedLines.length; index += 1) {
    let line = normalizedLines[index]!;
    if (!line) continue;
    let option = line.match(optionMarker);

    // Scanner OCR occasionally drops only the punctuation after an option
    // letter (for example "Ajalloy ..." while B/C/D remain "B)..."). Recover
    // that narrowly when the next explicit option proves the expected order.
    if (!option) {
      const expected = String.fromCharCode(65 + currentOption + 1) as "A" | "B" | "C" | "D";
      const compact = line.match(/^([A-D])(?=\p{L})(.+)$/iu);
      const nextExplicit = firstFollowingExplicitOption(index);
      const expectedNext = currentOption + 2 <= 3
        ? String.fromCharCode(65 + currentOption + 2) as "A" | "B" | "C" | "D"
        : null;
      if (compact && compact[1]!.toUpperCase() === expected && nextExplicit === expectedNext) {
        line = `${expected})${compact[2]!}`;
        option = line.match(optionMarker);
      }
    }

    if (option) {
      currentOption += 1;
      if (currentOption !== options.length) return null;
      if (optionLabel(option[1] ?? option[2] ?? option[3]) !== String.fromCharCode(65 + currentOption)) return null;
      options.push(option[4]!.trim());
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
  let activeOptionCount = 0;
  for (let line = 0; line < lines.length; line += 1) {
    const markerLine = normalizeMarkdownMarkerLine(lines[line]!);
    const match = markerLine.match(questionMarker);
    if (match) {
      const numericQuestion = !/^(?:q(?:uestion)?\s*)/iu.test(markerLine);
      if (!numericQuestion || activeOptionCount >= 4 || starts.length === 0) {
        starts.push({ line, ordinal: Number(match[1]), firstText: match[2]!.trim() });
        activeOptionCount = 0;
        continue;
      }
    }
    if (markerLine.match(optionMarker)) activeOptionCount += 1;
  }
  if (starts.length === 0) return null;
  const parsed: ParsedBlock[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const current = starts[index]!;
    const next = starts[index + 1];
    const blockLines = [current.firstText, ...lines.slice(current.line + 1, next?.line ?? lines.length)];
    const block = parseBlock(blockLines, current.ordinal);
    if (!block) return null;
    parsed.push(block);
  }
  const firstOrdinal = parsed[0]!.sourceOrdinal;
  for (let index = 0; index < parsed.length; index += 1) {
    if (parsed[index]!.sourceOrdinal !== firstOrdinal + index) return null;
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
      section: `Question ${item.sourceOrdinal}`,
      supportingExcerpt: [
        item.question,
        ...item.options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`),
      ].join("\n").slice(0, 300),
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