import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
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
import { aiProviderMetadataSchema } from "../server/services/ai/schemas.js";
import {
  CloudflareClient,
  type CloudflareFetch,
} from "../server/services/ai/cloudflare/CloudflareClient.js";
import { CloudflareMarkdownConverter } from "../server/services/ai/cloudflare/CloudflareMarkdownConverter.js";
import { AIInputService } from "../server/services/ai/input/AIInputService.js";
import { AITemporaryFileManager } from "../server/services/ai/input/temporaryFiles.js";
import { renderPDFPages } from "../server/services/ai/input/pdfVisualSource.js";

const config = {
  accountId: "account-test",
  apiToken: "token-test",
  model: DEFAULT_CLOUDFLARE_MODEL,
  timeoutMs: 5_000,
  markdownTimeoutMs: 5_000,
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

test("empty PDF conversion falls back to bounded ordered PNG page coverage", async () => {
  const document = await PDFDocument.create();
  for (let index = 0; index < 4; index += 1) document.addPage([612, 792]);
  const pdfBytes = new Uint8Array(await document.save());
  const root = await mkdtemp(join(tmpdir(), "cloudflare-pdf-pages-"));
  const calls: Array<{ mimeType: string; filename: string; bytes: Uint8Array }> = [];
  const converter = new CloudflareMarkdownConverter({
    toMarkdown: async (bytes: Uint8Array, mimeType: string, filename: string) => {
      calls.push({ bytes, mimeType, filename });
      return {
        data: mimeType === "application/pdf" ? "" : `rendered ${filename}`,
        format: "markdown",
      };
    },
  } as never);
  try {
    const input = new AIInputService({}, new AITemporaryFileManager(root));
    const result = await input.withPreparedInput({
      kind: "pdf",
      file: {
        bytes: pdfBytes,
        claimedMimeType: "application/pdf",
        originalFilename: "scan.pdf",
      },
    }, (prepared) => converter.convert(prepared.contents, new AbortController().signal));

    assert.equal(result.length, 4);
    assert.deepEqual(result.map((part) => part.page), [1, 2, 3, 4]);
    assert.deepEqual(result.map((part) => part.inputType), ["pdf", "pdf", "pdf", "pdf"]);
    assert.deepEqual(calls.map((call) => call.mimeType), [
      "application/pdf",
      "image/png",
      "image/png",
      "image/png",
      "image/png",
    ]);
    assert.deepEqual(calls.slice(1).map((call) => call.filename), [
      "source-page-1.png",
      "source-page-2.png",
      "source-page-3.png",
      "source-page-4.png",
    ]);
    assert.ok(calls.slice(1).every((call) =>
      call.bytes[0] === 0x89 &&
      call.bytes[1] === 0x50 &&
      call.bytes[2] === 0x4e &&
      call.bytes[3] === 0x47,
    ));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PDF visual recovery honors a deferred bounded page range", async () => {
  const document = await PDFDocument.create();
  for (let index = 0; index < 4; index += 1) document.addPage([612, 792]);
  const pdfBytes = new Uint8Array(await document.save());
  const root = await mkdtemp(join(tmpdir(), "cloudflare-pdf-range-"));
  try {
    const input = new AIInputService({}, new AITemporaryFileManager(root));
    await input.withPreparedInput({
      kind: "pdf",
      file: { bytes: pdfBytes, claimedMimeType: "application/pdf", originalFilename: "range.pdf" },
    }, async (prepared) => {
      if (prepared.input.kind !== "pdf" || prepared.input.pdf.fileSource.kind !== "staged_file") {
        assert.fail("Expected a staged PDF.");
      }
      const pages = await renderPDFPages(
        prepared.input.pdf.fileSource.capability,
        prepared.input.pdf.source,
        prepared.input.pdf.pageCount,
        { startPage: 2, endPage: 3, maxPages: 2 },
      );
      assert.deepEqual(pages.map((page) => page.page), [2, 3]);
      assert.ok(pages.every((page) => page.mimeType === "image/png" && page.bytes.length > 100));
      assert.deepEqual(pages.map((page) => page.source.page), [2, 3]);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mixed PDFs preserve converted text and embedded visual-page coverage", async () => {
  const document = await PDFDocument.create();
  document.addPage([612, 792]).drawText("Text-layer page");
  const visualPage = document.addPage([612, 792]);
  const image = await document.embedPng(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ));
  visualPage.drawImage(image, { x: 100, y: 100, width: 200, height: 200 });
  const pdfBytes = new Uint8Array(await document.save());
  const root = await mkdtemp(join(tmpdir(), "cloudflare-mixed-pdf-"));
  const calls: string[] = [];
  const converter = new CloudflareMarkdownConverter({
    toMarkdown: async (_bytes: Uint8Array, mimeType: string, filename: string) => {
      calls.push(`${mimeType}:${filename}`);
      return {
        data: mimeType === "application/pdf" ? "mixed text layer" : `visual ${filename}`,
        format: "markdown",
      };
    },
  } as never);
  try {
    const input = new AIInputService({}, new AITemporaryFileManager(root));
    const result = await input.withPreparedInput({
      kind: "pdf",
      file: { bytes: pdfBytes, claimedMimeType: "application/pdf", originalFilename: "mixed.pdf" },
    }, (prepared) => converter.convert(prepared.contents, new AbortController().signal));

    assert.equal(result[0]?.text, "mixed text layer");
    assert.deepEqual(result.filter((part) => part.page !== undefined).map((part) => part.page), [1, 2]);
    assert.ok(calls.includes("application/pdf:source.pdf"));
    assert.ok(calls.includes("image/png:source-page-2.png"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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

test("Cloudflare binary transport metadata matches the shared response contract", async () => {
  const fakeClient = {
    run: async () => ({
      text: JSON.stringify({ items: [{ value: "converted" }], uncertainties: [] }),
      responseId: "ray-media",
    }),
  };
  const converter = {
    convert: async () => [{ inputType: "pdf" as const, text: "converted" }],
  };
  const provider = new CloudflareAIProvider(config, fakeClient as never, converter as never);
  const result = await provider.generateStructured({
    contents: [{
      kind: "file",
      inputType: "pdf",
      mimeType: "application/pdf",
      fileSource: {
        kind: "existing_resource",
        resourceId: "resource-1",
        ownership: "borrowed",
      },
      source: { inputType: "pdf", label: "scan.pdf" },
      sizeBytes: 10,
      sha256: "a".repeat(64),
    }],
    responseSchema: z.object({
      items: z.array(z.object({ value: z.string().min(1) })),
      uncertainties: z.array(z.string()),
    }),
  });
  assert.equal(result.meta.transport, "markdown_conversion");
  assert.equal(aiProviderMetadataSchema.safeParse(result.meta).success, true);
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

test("Cloudflare reuses one conversion across calls and reconverts after dispose", async () => {
  let conversions = 0;
  let inferences = 0;
  const converter = {
    convert: async () => {
      conversions += 1;
      return [{ inputType: "pdf" as const, text: "converted source" }];
    },
  };
  const client = {
    run: async () => {
      inferences += 1;
      return {
        text: JSON.stringify({ items: [{ value: `result-${inferences}` }], uncertainties: [] }),
        responseId: `ray-${inferences}`,
      };
    },
  };
  const provider = new CloudflareAIProvider(config, client as never, converter as never);
  const contents: import("../server/services/ai/input/contracts.js").AIContentPart[] = [{
    kind: "file" as const,
    inputType: "pdf" as const,
    mimeType: "application/pdf" as const,
    fileSource: { kind: "existing_resource" as const, resourceId: "same-source", ownership: "borrowed" as const },
    source: { inputType: "pdf" as const, label: "source.pdf" },
    sizeBytes: 4,
    sha256: "same-source-hash",
  }];
  const schema = z.object({
    items: z.array(z.object({ value: z.string().min(1) })),
    uncertainties: z.array(z.string()),
  });
  for (let index = 0; index < 3; index += 1) {
    await provider.generateStructured({ contents, responseSchema: schema, reusePreparedMedia: true });
  }
  assert.equal(conversions, 1);
  assert.ok(inferences > 1);
  await provider.dispose();
  await provider.generateStructured({ contents, responseSchema: schema, reusePreparedMedia: true });
  assert.equal(conversions, 2);
});

test("Cloudflare retry classification covers transient, auth, invalid, and network failures", async () => {
  for (const status of [500, 502, 503, 504, 429]) {
    const client = new CloudflareClient(config, async () => response({ success: false }, status));
    await assert.rejects(
      client.run([{ role: "user", content: "test" }], { type: "json_schema" }, new AbortController().signal),
      (error: unknown) => error instanceof AIServiceError && error.retryable === true,
    );
  }
  for (const status of [400, 401, 403]) {
    const client = new CloudflareClient(config, async () => response({ success: false }, status));
    await assert.rejects(
      client.run([{ role: "user", content: "test" }], { type: "json_schema" }, new AbortController().signal),
      (error: unknown) => error instanceof AIServiceError && error.retryable !== true,
    );
  }
  const provider = new CloudflareAIProvider(config, {
    run: async () => { throw Object.assign(new Error("connection reset"), { code: "ECONNRESET" }); },
  } as never);
  await assert.rejects(
    provider.generateStructured({
      contents: [textPart("test")],
      responseSchema: z.object({ items: z.array(z.unknown()), uncertainties: z.array(z.string()) }),
    }),
    (error: unknown) => error instanceof AIServiceError && error.retryable === true,
  );
});