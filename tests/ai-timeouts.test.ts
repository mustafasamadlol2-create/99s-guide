import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_AI_TIMEOUT_MS,
  DEFAULT_CLOUDFLARE_MARKDOWN_TIMEOUT_MS,
  DEFAULT_CLOUDFLARE_VISION_TIMEOUT_MS,
  getCloudflareConfig,
  getGeminiConfig,
} from "../server/services/ai/config.js";
import {
  DEFAULT_FILE_CLEANUP_TIMEOUT_MS,
  DEFAULT_FILE_PROCESSING_TIMEOUT_MS,
  getGeminiMediaConfig,
} from "../server/services/ai/gemini/config.js";
import { AI_PREVIEW_TIMEOUT_MS } from "../src/features/lectures/ai/api/aiPreviewApi";

test("Cloudflare production AI uses finite per-request timeout defaults", () => {
  assert.equal(DEFAULT_AI_TIMEOUT_MS, 120_000);
  assert.equal(
    getCloudflareConfig({
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_AI_API_TOKEN: "token",
    }).timeoutMs,
    120_000,
  );
  assert.equal(
    getCloudflareConfig({
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_AI_API_TOKEN: "token",
    }).markdownTimeoutMs,
    DEFAULT_CLOUDFLARE_MARKDOWN_TIMEOUT_MS,
  );
  assert.equal(
    getCloudflareConfig({
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_AI_API_TOKEN: "token",
    }).visionTimeoutMs,
    DEFAULT_CLOUDFLARE_VISION_TIMEOUT_MS,
  );
});

test("Cloudflare timeout overrides are accepted only inside finite safety bounds", () => {
  const valid = getCloudflareConfig({
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_AUTH_TOKEN: "token",
    CLOUDFLARE_INFERENCE_TIMEOUT_MS: "150000",
    CLOUDFLARE_MARKDOWN_TIMEOUT_MS: "120000",
    CLOUDFLARE_VISION_TIMEOUT_MS: "120000",
  });
  assert.equal(valid.timeoutMs, 150_000);
  assert.equal(valid.markdownTimeoutMs, 120_000);
  assert.equal(valid.visionTimeoutMs, 120_000);

  for (const value of ["0", "-1", "NaN", "600000", "900001"]) {
    const config = getCloudflareConfig({
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_AI_API_TOKEN: "token",
      CLOUDFLARE_INFERENCE_TIMEOUT_MS: value,
    });
    assert.equal(config.timeoutMs, DEFAULT_AI_TIMEOUT_MS);
  }
});

test("legacy Gemini timeout helpers remain bounded but are not production-selected", () => {
  assert.equal(getGeminiConfig({ GEMINI_API_KEY: "test" }).timeoutMs, DEFAULT_AI_TIMEOUT_MS);
  assert.equal(
    getGeminiConfig({ GEMINI_API_KEY: "test", GEMINI_OPERATION_TIMEOUT_MS: "150000" }).timeoutMs,
    150_000,
  );
  assert.equal(getGeminiMediaConfig({}).fileProcessingTimeoutMs, DEFAULT_FILE_PROCESSING_TIMEOUT_MS);
  assert.equal(getGeminiMediaConfig({}).fileCleanupTimeoutMs, DEFAULT_FILE_CLEANUP_TIMEOUT_MS);
});

test("frontend preview has a finite overall deadline longer than individual provider calls", () => {
  assert.equal(AI_PREVIEW_TIMEOUT_MS, 12 * 60_000);
  assert.ok(AI_PREVIEW_TIMEOUT_MS > DEFAULT_AI_TIMEOUT_MS);
  assert.ok(AI_PREVIEW_TIMEOUT_MS > DEFAULT_CLOUDFLARE_MARKDOWN_TIMEOUT_MS);
  assert.ok(AI_PREVIEW_TIMEOUT_MS > DEFAULT_CLOUDFLARE_VISION_TIMEOUT_MS);
});
