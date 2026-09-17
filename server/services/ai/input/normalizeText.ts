import { AIServiceError } from "../errors.js";
import { sha256Text } from "./hash.js";

export interface NormalizedTextValue {
  text: string;
  sizeBytes: number;
  sha256: string;
}

export function normalizeAIText(
  value: unknown,
  maxBytes: number,
): NormalizedTextValue {
  if (typeof value !== "string") {
    throw new AIServiceError("AI_INPUT_INVALID", {
      publicMessage: "Pasted text must be a string.",
      diagnosticMessage: "Text input was not a string.",
    });
  }

  const text = value.replace(/\r\n?/gu, "\n").trim();
  if (!text) {
    throw new AIServiceError("AI_INPUT_INVALID", {
      publicMessage: "Pasted text cannot be empty.",
      diagnosticMessage: "Text input was empty after normalization.",
    });
  }

  const sizeBytes = Buffer.byteLength(text, "utf8");
  if (sizeBytes > maxBytes) {
    throw new AIServiceError("AI_INPUT_TOO_LARGE", {
      publicMessage: "Pasted text exceeds the allowed size.",
      diagnosticMessage: `Normalized text exceeded the configured ${maxBytes}-byte limit.`,
    });
  }

  return { text, sizeBytes, sha256: sha256Text(text) };
}