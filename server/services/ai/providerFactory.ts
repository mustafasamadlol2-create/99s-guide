import type { AIProvider } from "./contracts.js";
import { getCloudflareConfig, getConfiguredAIProvider, getGeminiConfig } from "./config.js";
import { CloudflareAIProvider } from "./cloudflare/CloudflareAIProvider.js";
import { GeminiProvider } from "./GeminiProvider.js";

export function createConfiguredAIProvider(
  environment: NodeJS.ProcessEnv = process.env,
): AIProvider {
  const provider = getConfiguredAIProvider(environment);
  if (provider === "gemini") return new GeminiProvider(getGeminiConfig(environment));
  return new CloudflareAIProvider(getCloudflareConfig(environment));
}