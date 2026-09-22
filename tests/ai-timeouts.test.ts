import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_AI_TIMEOUT_MS,
  DEFAULT_CLOUDFLARE_MARKDOWN_TIMEOUT_MS,
  getCloudflareConfig,
  getGeminiConfig,
} from "../server/services/ai/config.js";
import {
  DEFAULT_FILE_CLEANUP_TIMEOUT_MS,
  DEFAULT_FILE_PROCESSING_TIMEOUT_MS,
  getGeminiMediaConfig,
} from "../server/services/ai/gemini/config.js";
import { AI_PREVIEW_TIMEOUT_MS } from "../src/features/lectures/ai/api/aiPreviewApi";

test("AI timeout defaults preserve the long-running production contract", () => {
  assert.equal(DEFAULT_AI_TIMEOUT_MS, 600_000);
  assert.equal(getGeminiConfig({ GEMINI_API_KEY: "test" }).timeoutMs, 600_000);
  assert.equal(
    getCloudflareConfig({
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_AI_API_TOKEN: "token",
    }).timeoutMs,
    600_000,
  );
  assert.equal(getGeminiMediaConfig({}).fileProcessingTimeoutMs, 600_000);
  assert.equal(getGeminiMediaConfig({}).fileCleanupTimeoutMs, DEFAULT_FILE_CLEANUP_TIMEOUT_MS);
});

test("AI timeout environment overrides accept valid values and reject invalid values", () => {
  assert.equal(
    getGeminiConfig({
      GEMINI_API_KEY: "test",
      AI_OPERATION_TIMEOUT_MS: "300000",
    }).timeoutMs,
    300_000,
  );
  assert.equal(
    getGeminiMediaConfig({
      GEMINI_FILE_PROCESSING_TIMEOUT_MS: "240000",
    }).fileProcessingTimeoutMs,
    240_000,
  );
  for (const value of ["0", "-1", "NaN", "120000", "900001"]) {
    assert.equal(
      getGeminiConfig({ GEMINI_API_KEY: "test", AI_OPERATION_TIMEOUT_MS: value }).timeoutMs,
      DEFAULT_AI_TIMEOUT_MS,
      `invalid AI_OPERATION_TIMEOUT_MS should fall back for ${value}`,
    );
    assert.equal(
      getGeminiMediaConfig({ GEMINI_FILE_PROCESSING_TIMEOUT_MS: value }).fileProcessingTimeoutMs,
      DEFAULT_FILE_PROCESSING_TIMEOUT_MS,
      `invalid GEMINI_FILE_PROCESSING_TIMEOUT_MS should fall back for ${value}`,
    );
  }
});

test("Cloudflare Markdown Conversion has a bounded independent timeout override", () => {
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
      CLOUDFLARE_MARKDOWN_TIMEOUT_MS: "120000",
    }).markdownTimeoutMs,
    120_000,
  );
});

test("frontend AI timeout is longer than server and media budgets", () => {
  assert.ok(AI_PREVIEW_TIMEOUT_MS > DEFAULT_AI_TIMEOUT_MS);
  assert.ok(DEFAULT_AI_TIMEOUT_MS >= DEFAULT_FILE_PROCESSING_TIMEOUT_MS);
});