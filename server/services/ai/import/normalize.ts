/**
 * Conservative, Unicode-aware text normalization for duplicate analysis.
 * This intentionally preserves Arabic letters and does not transliterate or stem.
 */
export function normalizeDuplicateText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/\s*([,.;:!?()[\]{}،؛؟])\s*/gu, "$1")
    .toLocaleLowerCase();
}

export function previewText(value: string, maxLength = 180): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}