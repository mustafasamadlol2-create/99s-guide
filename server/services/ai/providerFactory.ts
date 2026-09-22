import type { AIProvider } from "./contracts.js";
import { getCloudflareConfig, getConfiguredAIProvider } from "./config.js";
import { CloudflareAIProvider } from "./cloudflare/CloudflareAIProvider.js";

/**
 * Production provider factory for 99's Guide.
 *
 * The app intentionally uses Cloudflare Workers AI only. We still validate
 * AI_PROVIDER so a stale `gemini` value fails loudly instead of silently
 * routing private lecture material to another provider.
 */
export function createConfiguredAIProvider(
  environment: NodeJS.ProcessEnv = process.env,
): AIProvider {
  getConfiguredAIProvider(environment);
  return new CloudflareAIProvider(getCloudflareConfig(environment));
}
