import { AIServiceError } from "./errors.js";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_AI_TIMEOUT_MS = 30_000;

export interface GeminiConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export function getGeminiConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GeminiConfig {
  const apiKey = environment.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new AIServiceError("AI_CONFIG_ERROR", {
      publicMessage: "AI service is not configured.",
      diagnosticMessage: "GEMINI_API_KEY is missing or empty.",
    });
  }

  return {
    apiKey,
    model: environment.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
    timeoutMs: DEFAULT_AI_TIMEOUT_MS,
  };
}