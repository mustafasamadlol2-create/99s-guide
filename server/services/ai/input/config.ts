export const MEBIBYTE = 1024 * 1024;

export const AI_INPUT_HARD_LIMITS = Object.freeze({
  maxPdfBytes: 50 * MEBIBYTE,
  maxImageBytes: 20 * MEBIBYTE,
  maxImageCount: 20,
  maxTextBytes: 1 * MEBIBYTE,
});

export const DEFAULT_AI_INPUT_LIMITS = Object.freeze({
  ...AI_INPUT_HARD_LIMITS,
});

export interface AIInputLimits {
  maxPdfBytes: number;
  maxImageBytes: number;
  maxImageCount: number;
  maxTextBytes: number;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

export function resolveAIInputLimits(
  configured: Partial<AIInputLimits> = {},
): AIInputLimits {
  return {
    maxPdfBytes: Math.min(
      positiveInteger(configured.maxPdfBytes ?? DEFAULT_AI_INPUT_LIMITS.maxPdfBytes, "maxPdfBytes"),
      AI_INPUT_HARD_LIMITS.maxPdfBytes,
    ),
    maxImageBytes: Math.min(
      positiveInteger(
        configured.maxImageBytes ?? DEFAULT_AI_INPUT_LIMITS.maxImageBytes,
        "maxImageBytes",
      ),
      AI_INPUT_HARD_LIMITS.maxImageBytes,
    ),
    maxImageCount: Math.min(
      positiveInteger(
        configured.maxImageCount ?? DEFAULT_AI_INPUT_LIMITS.maxImageCount,
        "maxImageCount",
      ),
      AI_INPUT_HARD_LIMITS.maxImageCount,
    ),
    maxTextBytes: Math.min(
      positiveInteger(
        configured.maxTextBytes ?? DEFAULT_AI_INPUT_LIMITS.maxTextBytes,
        "maxTextBytes",
      ),
      AI_INPUT_HARD_LIMITS.maxTextBytes,
    ),
  };
}