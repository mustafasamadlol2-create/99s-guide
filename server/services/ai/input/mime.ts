import type { SupportedAIBinaryMimeType } from "./contracts.js";

const MIME_ALIASES: Readonly<Record<string, SupportedAIBinaryMimeType>> = {
  "application/pdf": "application/pdf",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/heic": "image/heic",
  "image/heif": "image/heif",
};

export function normalizeAIBinaryMimeType(
  value: string,
): SupportedAIBinaryMimeType | null {
  return MIME_ALIASES[value.trim().toLowerCase()] ?? null;
}

export function sanitizeDisplayFilename(value?: string): string {
  const normalizedSeparators = (value ?? "").replaceAll("\\", "/");
  const basename = normalizedSeparators.split("/").pop() ?? "";
  const withoutControls = Array.from(basename)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127;
    })
    .join("");
  const compact = withoutControls.replace(/\s+/gu, " ").trim();
  const limited = Array.from(compact).slice(0, 120).join("");
  return limited && limited !== "." && limited !== ".." ? limited : "upload";
}

export function sanitizeSourceLabel(value: string | undefined, fallback: string): string {
  const withoutControls = Array.from(value ?? "")
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127;
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  return Array.from(withoutControls).slice(0, 200).join("") || fallback;
}