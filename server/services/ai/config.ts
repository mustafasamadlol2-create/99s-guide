import { AIServiceError } from "./errors.js";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_CLOUDFLARE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const DEFAULT_AI_TIMEOUT_MS = 240_000;
export const MIN_AI_TIMEOUT_MS = 10_000;
export const MAX_AI_TIMEOUT_MS = 600_000;
export const DEFAULT_CLOUDFLARE_CHUNK_CHARS = 40_000;
export const DEFAULT_CLOUDFLARE_MAX_OUTPUT_TOKENS = 4_096;

export interface GeminiConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export interface CloudflareConfig {
  accountId: string;
  apiToken: string;
  model: string;
  timeoutMs: number;
  chunkChars: number;
  maxOutputTokens: number;
}

export type AIProviderName = "cloudflare" | "gemini";

function resolveTimeoutMs(
  environment: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw = environment[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < MIN_AI_TIMEOUT_MS || parsed > MAX_AI_TIMEOUT_MS) {
    throw new AIServiceError("AI_CONFIG_ERROR", {
      publicMessage: "AI service is not configured.",
      diagnosticMessage: `${key} must be between ${MIN_AI_TIMEOUT_MS} and ${MAX_AI_TIMEOUT_MS} milliseconds.`,
    });
  }
  return Math.round(parsed);
}

export function getConfiguredAIProvider(
  environment: NodeJS.ProcessEnv = process.env,
): AIProviderName {
  const provider = environment.AI_PROVIDER?.trim().toLowerCase() || "cloudflare";
  if (provider === "cloudflare" || provider === "gemini") return provider;
  throw new AIServiceError("AI_CONFIG_ERROR", {
    publicMessage: "AI service is not configured.",
    diagnosticMessage: "AI_PROVIDER must be cloudflare or gemini.",
  });
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
    timeoutMs: resolveTimeoutMs(environment, "AI_TIMEOUT_MS", DEFAULT_AI_TIMEOUT_MS),
  };
}

export function getCloudflareConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CloudflareConfig {
  const accountId = environment.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = environment.CLOUDFLARE_AI_API_TOKEN?.trim();
  if (!accountId || !apiToken) {
    throw new AIServiceError("AI_CONFIG_ERROR", {
      publicMessage: "AI service is not configured.",
      diagnosticMessage: "Cloudflare AI account credentials are missing or empty.",
    });
  }

  return {
    accountId,
    apiToken,
    model: environment.CLOUDFLARE_TEXT_MODEL?.trim() || DEFAULT_CLOUDFLARE_MODEL,
    timeoutMs: resolveTimeoutMs(environment, "AI_TIMEOUT_MS", DEFAULT_AI_TIMEOUT_MS),
    chunkChars: DEFAULT_CLOUDFLARE_CHUNK_CHARS,
    maxOutputTokens: DEFAULT_CLOUDFLARE_MAX_OUTPUT_TOKENS,
  };
}