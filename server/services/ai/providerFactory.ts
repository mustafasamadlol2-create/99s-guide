import type { AIProvider } from "./contracts.js";
import { getCloudflareConfig, getConfiguredAIProvider, getGeminiConfig } from "./config.js";
import { CloudflareAIProvider } from "./cloudflare/CloudflareAIProvider.js";
import { FallbackAIProvider } from "./FallbackAIProvider.js";
import { GeminiProvider } from "./GeminiProvider.js";

function hasGemini(environment: NodeJS.ProcessEnv): boolean {
  return Boolean(environment.GEMINI_API_KEY?.trim());
}

function hasCloudflare(environment: NodeJS.ProcessEnv): boolean {
  return Boolean(environment.CLOUDFLARE_ACCOUNT_ID?.trim() && environment.CLOUDFLARE_AI_API_TOKEN?.trim());
}

export function createConfiguredAIProvider(
  environment: NodeJS.ProcessEnv = process.env,
): AIProvider {
  const provider = getConfiguredAIProvider(environment);
  if (provider === "gemini") {
    const primary = new GeminiProvider(getGeminiConfig(environment));
    return hasCloudflare(environment)
      ? new FallbackAIProvider(primary, new CloudflareAIProvider(getCloudflareConfig(environment)))
      : primary;
  }
  const primary = new CloudflareAIProvider(getCloudflareConfig(environment));
  return hasGemini(environment)
    ? new FallbackAIProvider(primary, new GeminiProvider(getGeminiConfig(environment)))
    : primary;
}
