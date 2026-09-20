import type { FlashcardExtractionProviderResponse } from "./schemas.js";

const frontMarker = /^\s*(?:q(?:uestion)?|front|term|concept)\s*[:：-]\s*(.+)$/iu;
const backMarker = /^\s*(?:a(?:nswer)?|back|definition|explanation)\s*[:：-]\s*(.+)$/iu;

/**
 * Conservative Q/A parser. It returns null for mixed or incomplete prose so
 * ordinary lecture text still uses the vision/document AI route.
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
    const line = rawLine.trim();
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
    if (!current) return null;
    if (mode === "front") current.front = `${current.front} ${line}`.trim();
    else if (mode === "back") current.back = `${current.back} ${line}`.trim();
    else return null;
  }
  if (current) cards.push(current);
  if (cards.length < 2 || cards.some((card) => !card.front || !card.back || card.front === card.back)) return null;
  return {
    items: cards.slice(0, maxItems).map((card) => ({
      clinicalConcept: card.front,
      explanation: card.back,
      source: { inputType: "text" as const, supportingExcerpt: `${card.front}\n${card.back}`.slice(0, 300) },
      confidence: 1,
      uncertainties: [],
    })),
    skippedItems: [],
    truncated: cards.length > maxItems,
    uncertainties: cards.length > maxItems
      ? [`The deterministic source contained ${cards.length} cards; only ${maxItems} are supported.`]
      : [],
  };
}