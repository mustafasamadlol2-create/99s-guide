import { DEFAULT_AI_TIMEOUT_MS } from "../config.js";

export const DEFAULT_INLINE_IMAGE_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
export const DEFAULT_FILE_PROCESSING_TIMEOUT_MS = 180_000;
export const DEFAULT_FILE_POLL_INTERVAL_MS = 750;
export const DEFAULT_FILE_CLEANUP_TIMEOUT_MS = 2_000;

export interface GeminiMediaConfig {
  inlineImageMaxTotalBytes: number;
  fileProcessingTimeoutMs: number;
  filePollIntervalMs: number;
  fileCleanupTimeoutMs?: number;
}

export function getGeminiMediaConfig(environment: NodeJS.ProcessEnv = process.env): GeminiMediaConfig {
  const number = (key: string, fallback: number, minimum: number) => {
    const parsed = Number(environment[key]);
    return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
  };
  return {
    inlineImageMaxTotalBytes: number(
      "GEMINI_INLINE_IMAGE_MAX_TOTAL_BYTES",
      DEFAULT_INLINE_IMAGE_MAX_TOTAL_BYTES,
      1,
    ),
    fileProcessingTimeoutMs: number(
      "GEMINI_FILE_PROCESSING_TIMEOUT_MS",
      DEFAULT_FILE_PROCESSING_TIMEOUT_MS,
      1,
    ),
    filePollIntervalMs: number(
      "GEMINI_FILE_POLL_INTERVAL_MS",
      DEFAULT_FILE_POLL_INTERVAL_MS,
      0,
    ),
    fileCleanupTimeoutMs: number(
      "GEMINI_FILE_CLEANUP_TIMEOUT_MS",
      DEFAULT_FILE_CLEANUP_TIMEOUT_MS,
      1,
    ),
  };
}

export const GEMINI_PROVIDER_DEFAULT_TIMEOUT_MS = DEFAULT_AI_TIMEOUT_MS;