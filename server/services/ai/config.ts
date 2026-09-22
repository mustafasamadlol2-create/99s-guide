import { AIServiceError } from "./errors.js";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_CLOUDFLARE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const DEFAULT_AI_TIMEOUT_MS = 600_000;
export const DEFAULT_CLOUDFLARE_MARKDOWN_TIMEOUT_MS = 300_000;
export const MAX_AI_TIMEOUT_MS = 900_000;
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
  markdownTimeoutMs: number;
  chunkChars: number;
  maxOutputTokens: number;
}

export type AIProviderName = "cloudflare" | "gemini";

export function readBoundedTimeout(
  environment: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  minimum = 1_000,
  maximum = MAX_AI_TIMEOUT_MS,
): number {
  const parsed = Number(environment[key]);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

export function getConfiguredAIProvider(
  environment: NodeJS.ProcessEnv = process.env,
): AIProviderName {
  const explicit = environment.AI_PROVIDER?.trim().toLowerCase();
  if (explicit === "cloudflare" || explicit === "gemini") return explicit;
  if (explicit) {
    throw new AIServiceError("AI_CONFIG_ERROR", {
      publicMessage: "AI service is not configured.",
      diagnosticMessage: "AI_PROVIDER must be cloudflare or gemini.",
    });
  }
  if (environment.GEMINI_API_KEY?.trim()) return "gemini";
  if (environment.CLOUDFLARE_ACCOUNT_ID?.trim() && environment.CLOUDFLARE_AI_API_TOKEN?.trim()) return "cloudflare";
  return "gemini";
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
    timeoutMs: readBoundedTimeout(environment, "AI_OPERATION_TIMEOUT_MS", DEFAULT_AI_TIMEOUT_MS, 240_000),
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
    timeoutMs: readBoundedTimeout(environment, "AI_OPERATION_TIMEOUT_MS", DEFAULT_AI_TIMEOUT_MS, 240_000),
    markdownTimeoutMs: readBoundedTimeout(
      environment,
      "CLOUDFLARE_MARKDOWN_TIMEOUT_MS",
      DEFAULT_CLOUDFLARE_MARKDOWN_TIMEOUT_MS,
    ),
    chunkChars: DEFAULT_CLOUDFLARE_CHUNK_CHARS,
    maxOutputTokens: DEFAULT_CLOUDFLARE_MAX_OUTPUT_TOKENS,
  };
}