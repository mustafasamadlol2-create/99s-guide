import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  DEFAULT_CLOUDFLARE_MODEL,
  getCloudflareConfig,
  getConfiguredAIProvider,
} from "../server/services/ai/config.js";
import { AIServiceError } from "../server/services/ai/errors.js";
import { createConfiguredAIProvider } from "../server/services/ai/providerFactory.js";
import {
  CloudflareAIProvider,
  splitBoundedText,
} from "../server/services/ai/cloudflare/CloudflareAIProvider.js";
import {
  CloudflareClient,
  type CloudflareFetch,
} from "../server/services/ai/cloudflare/CloudflareClient.js";

const config = {
  accountId: "account-test",
  apiToken: "token-test",
  model: DEFAULT_CLOUDFLARE_MODEL,
  timeoutMs: 5_000,
  chunkChars: 10,
  maxOutputTokens: 4_096,
};

function response(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function textPart(text: string) {
  return {
    kind: "text" as const,
    text,
    source: { inputType: "text" as const, label: "test" },
    sizeBytes: Buffer.byteLength(text),
    sha256: "test-hash",
  };
}

test("Cloudflare is the explicit default and invalid providers fail safely", () => {
  assert.equal(getConfiguredAIProvider({}), "cloudflare");
  assert.equal(getConfiguredAIProvider({ AI_PROVIDER: "gemini" }), "gemini");
  assert.throws(
    () => getConfiguredAIProvider({ AI_PROVIDER: "other" }),
    (error: unknown) => error instanceof AIServiceError && error.code === "AI_CONFIG_ERROR",
  );
  assert.equal(getCloudflareConfig({
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_AI_API_TOKEN: "token",
  }).model, DEFAULT_CLOUDFLARE_MODEL);
});

test("provider selection has no automatic Gemini fallback", () => {
  const cloudflare = createConfiguredAIProvider({
    AI_PROVIDER: "cloudflare",
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_AI_API_TOKEN: "token",
  });
  assert.equal(cloudflare.constructor.name, "CloudflareAIProvider");

  const gemini = createConfiguredAIProvider({
    AI_PROVIDER: "gemini",
    GEMINI_API_KEY: "synthetic-test-key",
  });
  assert.equal(gemini.constructor.name, "GeminiProvider");
});

test("Cloudflare inference uses Bearer auth and JSON Schema response_format", async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  const fetchImpl: CloudflareFetch = async (url, init) => {
    captured = { url: String(url), init };
    return response({
      success: true,
      result: { response: '{"ok":true}' },
    }, 200, { "cf-ray": "ray-test" });
  };
  const client = new CloudflareClient(config, fetchImpl);
  const result = await client.run(
    [{ role: "user", content: "test" }],
    { type: "json_schema", json_schema: { type: "object" } },
    new AbortController().signal,
  );

  assert.equal(result.text, '{"ok":true}');
  assert.equal(result.responseId, "ray-test");
  assert.equal(
    captured?.url,
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/%40cf/meta/llama-3.3-70b-instruct-fp8-fast`,
  );
  assert.equal((captured?.init.headers as Record<string, string>).Authorization, `Bearer ${config.apiToken}`);
  assert.equal((captured?.init.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(String(captured?.init.body)), {
    messages: [{ role: "user", content: "test" }],
    response_format: { type: "json_schema", json_schema: { type: "object" } },
    max_tokens: 4_096,
  });
});

test("Cloudflare Markdown Conversion uses multipart files without exposing the boundary", async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  const fetchImpl: CloudflareFetch = async (url, init) => {
    captured = { url: String(url), init };
    return response({
      success: true,
      result: [{ format: "markdown", data: "# Converted", tokens: 2 }],
    });
  };
  const client = new CloudflareClient(config, fetchImpl);
  const result = await client.toMarkdown(
    new Uint8Array([37, 80, 68, 70]),
    "application/pdf",
    "source.pdf",
    new AbortController().signal,
  );

  assert.equal(result.data, "# Converted");
  assert.equal(captured?.url, `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/tomarkdown`);
  assert.equal((captured?.init.headers as Record<string, string>).Authorization, `Bearer ${config.apiToken}`);
  assert.equal((captured?.init.headers as Record<string, string>)["Content-Type"], undefined);
  assert.ok(captured?.init.body instanceof FormData);
  assert.equal((captured?.init.body as FormData).has("files"), true);
});

test("Cloudflare provider validates every chunk with the original Zod schema", async () => {
  const schema = z.object({
    items: z.array(z.object({ value: z.string().min(1) })),
    uncertainties: z.array(z.string()),
  });
  const calls: Array<{ messages: unknown[]; responseFormat: unknown }> = [];
  const fakeClient = {
    run: async (messages: unknown[], responseFormat: unknown) => {
      calls.push({ messages, responseFormat });
      return {
        text: JSON.stringify({ items: [{ value: `chunk-${calls.length}` }], uncertainties: [] }),
        responseId: `ray-${calls.length}`,
      };
    },
  };
  const provider = new CloudflareAIProvider(
    config,
    fakeClient as never,
  );
  const result = await provider.generateStructured({
    contents: [textPart("abcdefghij klmnopqrst uvwxyz")],
    responseSchema: schema,
    trustedSystemInstruction: "Extract values.",
    operation: "extract",
    maxItems: 100,
  });

  assert.equal(calls.length, 3);
  assert.equal(result.data.items.length, 3);
  assert.equal(result.data.items[0]?.value, "chunk-1");
  assert.equal(result.meta.provider, "cloudflare");
  assert.equal(result.meta.model, DEFAULT_CLOUDFLARE_MODEL);
  assert.equal(result.meta.responseId, "ray-3");
  assert.equal((calls[0]?.responseFormat as { type: string }).type, "json_schema");
  assert.equal(
    ((calls[0]?.messages[0] as { role: string }).role),
    "system",
  );
});

test("Cloudflare provider maps rate limits without retrying or leaking provider bodies", async () => {
  const fetchImpl: CloudflareFetch = async () =>
    response({ success: false, errors: [{ message: "private provider detail" }] }, 429);
  const client = new CloudflareClient(config, fetchImpl);
  await assert.rejects(
    client.run(
      [{ role: "user", content: "test" }],
      { type: "json_schema", json_schema: {} },
      new AbortController().signal,
    ),
    (error: unknown) =>
      error instanceof AIServiceError &&
      error.code === "AI_RATE_LIMITED" &&
      error.publicMessage.includes("temporarily rate limited") &&
      !error.publicMessage.includes("private provider detail"),
  );
});

test("Cloudflare chunking preserves Unicode boundaries and source order", () => {
  const text = "ألفا🙂\n\nبيتا🚑\n\nجاما";
  const chunks = splitBoundedText(text, 6);
  assert.equal(chunks.join("\n\n"), text);
  assert.ok(chunks.every((chunk) => chunk.length <= 6));
  assert.equal(chunks[0], "ألفا🙂");
  assert.equal(chunks[2], "جاما");
});