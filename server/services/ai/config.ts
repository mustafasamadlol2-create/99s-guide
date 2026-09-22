import { AIServiceError } from "./errors.js";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_CLOUDFLARE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const DEFAULT_CLOUDFLARE_VISION_MODEL = "@cf/moondream/moondream3.1-9B-A2B";

/**
 * Cloudflare calls are deliberately bounded per network request. Large sources
 * are handled as multiple smaller chunks/pages instead of allowing one fetch to
 * wait for many minutes. This prevents a UI job from looking permanently stuck.
 */
export const DEFAULT_AI_TIMEOUT_MS = 120_000;
export const DEFAULT_CLOUDFLARE_MARKDOWN_TIMEOUT_MS = 90_000;
export const DEFAULT_CLOUDFLARE_VISION_TIMEOUT_MS = 90_000;
export const MAX_AI_TIMEOUT_MS = 180_000;
export const DEFAULT_CLOUDFLARE_CHUNK_CHARS = 12_000;
export const DEFAULT_CLOUDFLARE_MAX_OUTPUT_TOKENS = 8_192;
export const DEFAULT_CLOUDFLARE_VISION_MAX_OUTPUT_TOKENS = 8_192;

export interface GeminiConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export interface CloudflareConfig {
  accountId: string;
  apiToken: string;
  model: string;
  visionModel: string;
  timeoutMs: number;
  markdownTimeoutMs: number;
  visionTimeoutMs: number;
  chunkChars: number;
  maxOutputTokens: number;
  visionMaxOutputTokens: number;
}

export type AIProviderName = "cloudflare";

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

/**
 * 99's Guide production AI is Cloudflare Workers AI only. Gemini credentials,
 * if they still exist in an old Render environment, are intentionally ignored.
 */
export function getConfiguredAIProvider(
  environment: NodeJS.ProcessEnv = process.env,
): AIProviderName {
  const explicit = environment.AI_PROVIDER?.trim().toLowerCase();
  if (!explicit || explicit === "cloudflare") return "cloudflare";
  throw new AIServiceError("AI_CONFIG_ERROR", {
    publicMessage: "AI service is not configured for Cloudflare Workers AI.",
    diagnosticMessage: "AI_PROVIDER must be cloudflare for this deployment.",
  });
}

/** Legacy helper retained for isolated tests/tools. The production provider
 * factory never selects Gemini. */
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
    timeoutMs: readBoundedTimeout(
      environment,
      "GEMINI_OPERATION_TIMEOUT_MS",
      readBoundedTimeout(environment, "AI_OPERATION_TIMEOUT_MS", DEFAULT_AI_TIMEOUT_MS),
    ),
  };
}

export function getCloudflareConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CloudflareConfig {
  const accountId = environment.CLOUDFLARE_ACCOUNT_ID?.trim();
  // Accept the project-specific name and Cloudflare's official/common aliases.
  // This avoids a deployment silently failing because Render uses AUTH_TOKEN.
  const apiToken = environment.CLOUDFLARE_AI_API_TOKEN?.trim()
    || environment.CLOUDFLARE_AUTH_TOKEN?.trim()
    || environment.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !apiToken) {
    throw new AIServiceError("AI_CONFIG_ERROR", {
      publicMessage: "Cloudflare Workers AI is not configured.",
      diagnosticMessage: "CLOUDFLARE_ACCOUNT_ID and a Cloudflare Workers AI API token are required.",
    });
  }

  return {
    accountId,
    apiToken,
    model: environment.CLOUDFLARE_TEXT_MODEL?.trim() || DEFAULT_CLOUDFLARE_MODEL,
    visionModel: environment.CLOUDFLARE_VISION_MODEL?.trim() || DEFAULT_CLOUDFLARE_VISION_MODEL,
    timeoutMs: readBoundedTimeout(
      environment,
      "CLOUDFLARE_INFERENCE_TIMEOUT_MS",
      readBoundedTimeout(environment, "AI_OPERATION_TIMEOUT_MS", DEFAULT_AI_TIMEOUT_MS, 30_000, MAX_AI_TIMEOUT_MS),
      30_000,
      MAX_AI_TIMEOUT_MS,
    ),
    markdownTimeoutMs: readBoundedTimeout(
      environment,
      "CLOUDFLARE_MARKDOWN_TIMEOUT_MS",
      DEFAULT_CLOUDFLARE_MARKDOWN_TIMEOUT_MS,
      20_000,
      MAX_AI_TIMEOUT_MS,
    ),
    visionTimeoutMs: readBoundedTimeout(
      environment,
      "CLOUDFLARE_VISION_TIMEOUT_MS",
      DEFAULT_CLOUDFLARE_VISION_TIMEOUT_MS,
      20_000,
      MAX_AI_TIMEOUT_MS,
    ),
    chunkChars: DEFAULT_CLOUDFLARE_CHUNK_CHARS,
    maxOutputTokens: DEFAULT_CLOUDFLARE_MAX_OUTPUT_TOKENS,
    visionMaxOutputTokens: DEFAULT_CLOUDFLARE_VISION_MAX_OUTPUT_TOKENS,
  };
}
