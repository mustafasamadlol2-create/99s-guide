import type { FlashcardExtractionProviderResponse } from "./schemas.js";

const frontMarker = /^\s*(?:q(?:uestion)?|front|term|concept)\s*[:：-]\s*(.+)$/iu;
const backMarker = /^\s*(?:a(?:nswer)?|back|definition|explanation)\s*[:：-]\s*(.+)$/iu;

function normalizeMarkdownMarkerLine(value: string): string {
  return value
    .replace(/\\([:：-])/gu, "$1")
    .replace(/\*\*|__/gu, "")
    .replace(/^\s*[-+*]\s+(?=(?:q(?:uestion)?|front|term|concept|a(?:nswer)?|back|definition|explanation)\b)/iu, "")
    .trimEnd();
}

/**
 * Conservative Q/A parser. A recognizable front is still reviewable when the
 * source has no explicit back; extraction must not turn that case into
 * generation or silently discard the source item.
 */
export function parseDeterministicFlashcards(
  text: string,
  maxItems = 100,
): FlashcardExtractionProviderResponse | null {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const cards: Array<{ front: string; back: string }> = [];
  let current: { front: string; back: string } | null = null;
  let mode: "front" | "back" | null = null;
  for (const rawLine of lines) {
    const line = normalizeMarkdownMarkerLine(rawLine).trim();
    if (!line) continue;
    const front = line.match(frontMarker);
    if (front) {
      if (current) cards.push(current);
      current = { front: front[1]!.trim(), back: "" };
      mode = "front";
      continue;
    }
    const back = line.match(backMarker);
    if (back) {
      if (!current || mode === "back") return null;
      current.back = back[1]!.trim();
      mode = "back";
      continue;
    }
    if (!current) {
      if (/^\[(?:source document(?: page \d+)?|image \d+)\]$/iu.test(line) ||
        /^#{1,6}\s+.+$/u.test(line) ||
        /^(?:flashcards?|study cards?)\s*[:：-]?$/iu.test(line)) {
        continue;
      }
      return null;
    }
    if (mode === "front") current.front = `${current.front} ${line}`.trim();
    else if (mode === "back") current.back = `${current.back} ${line}`.trim();
    else return null;
  }
  if (current) cards.push(current);
  if (cards.length === 0 || cards.some((card) => !card.front || card.front === card.back)) return null;
  return {
    items: cards.slice(0, maxItems).map((card) => ({
      clinicalConcept: card.front,
      explanation: card.back || null,
      source: {
        inputType: "text" as const,
        section: `Flashcard ${cards.indexOf(card) + 1}`,
        supportingExcerpt: `${card.front}\n${card.back}`.slice(0, 300),
      },
      confidence: card.back ? 1 : 0.8,
      uncertainties: card.back ? [] : ["The source provided a front without an explicit back."],
    })),
    skippedItems: [],
    truncated: cards.length > maxItems,
    uncertainties: cards.length > maxItems
      ? [`The deterministic source contained ${cards.length} cards; only ${maxItems} are supported.`]
      : [],
  };
}