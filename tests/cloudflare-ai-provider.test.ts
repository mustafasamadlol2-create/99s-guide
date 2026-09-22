import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { AIContentService } from "../server/services/ai/AIContentService.js";
import {
  DEFAULT_CLOUDFLARE_MODEL,
  DEFAULT_CLOUDFLARE_VISION_MODEL,
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
import {
  forEachRenderedPDFPage,
  renderPDFPages,
} from "../server/services/ai/input/pdfVisualSource.js";
import { FlashcardAIEngine } from "../server/services/ai/flashcard/FlashcardAIEngine.js";
import { MCQAIEngine } from "../server/services/ai/mcq/MCQAIEngine.js";

const config = {
  accountId: "account-test",
  apiToken: "token-test",
  model: DEFAULT_CLOUDFLARE_MODEL,
  visionModel: DEFAULT_CLOUDFLARE_VISION_MODEL,
  timeoutMs: 5_000,
  markdownTimeoutMs: 5_000,
  visionTimeoutMs: 5_000,
  chunkChars: 10,
  maxOutputTokens: 8_192,
  visionMaxOutputTokens: 8_192,
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

test("production provider selection is Cloudflare-only", () => {
  assert.equal(getConfiguredAIProvider({}), "cloudflare");
  assert.equal(getConfiguredAIProvider({ GEMINI_API_KEY: "synthetic-test-key" }), "cloudflare");
  assert.equal(getConfiguredAIProvider({
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_AI_API_TOKEN: "token",
  }), "cloudflare");
  assert.throws(
    () => getConfiguredAIProvider({ AI_PROVIDER: "gemini" }),
    (error: unknown) => error instanceof AIServiceError && error.code === "AI_CONFIG_ERROR",
  );
  assert.throws(
    () => getConfiguredAIProvider({ AI_PROVIDER: "other" }),
    (error: unknown) => error instanceof AIServiceError && error.code === "AI_CONFIG_ERROR",
  );
  const cf = getCloudflareConfig({
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_AUTH_TOKEN: "token",
  });
  assert.equal(cf.model, DEFAULT_CLOUDFLARE_MODEL);
  assert.equal(cf.visionModel, DEFAULT_CLOUDFLARE_VISION_MODEL);
});

test("provider factory never falls back to Gemini", () => {
  const cloudflare = createConfiguredAIProvider({
    AI_PROVIDER: "cloudflare",
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_AI_API_TOKEN: "token",
    GEMINI_API_KEY: "ignored-test-key",
  });
  assert.equal(cloudflare.constructor.name, "CloudflareAIProvider");
  assert.throws(
    () => createConfiguredAIProvider({
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "synthetic-test-key",
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_AI_API_TOKEN: "token",
    }),
    (error: unknown) => error instanceof AIServiceError && error.code === "AI_CONFIG_ERROR",
  );
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
    max_tokens: 8_192,
    temperature: 0,
    stream: false,
  });
});

test("Cloudflare retries documented JSON-mode schema failure once as json_object", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const fetchImpl: CloudflareFetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (requests.length === 1) {
      return response({ success: false, errors: [{ message: "JSON Mode couldn't be met" }] }, 400);
    }
    return response({ success: true, result: { response: '{"items":[]}' } });
  };
  const client = new CloudflareClient(config, fetchImpl);
  const result = await client.run(
    [{ role: "user", content: "test" }],
    { type: "json_schema", json_schema: { type: "object" } },
    new AbortController().signal,
  );

  assert.equal(result.text, '{"items":[]}');
  assert.equal(requests.length, 2);
  assert.equal((requests[0]?.response_format as { type: string }).type, "json_schema");
  assert.equal((requests[1]?.response_format as { type: string }).type, "json_object");
  assert.match(
    String((requests[1]?.messages as Array<{ content: string }>)[0]?.content),
    /response contract exactly/iu,
  );
});

test("Cloudflare vision OCR uses the configured Workers AI vision model", async () => {
  let captured: { url: string; body: Record<string, unknown> } | undefined;
  const fetchImpl: CloudflareFetch = async (url, init) => {
    captured = {
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    };
    return response({ success: true, result: { answer: "Q1 A) Alpha B) Beta" } }, 200, { "cf-ray": "vision-ray" });
  };
  const client = new CloudflareClient(config, fetchImpl);
  const result = await client.visionToText(
    new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    "image/jpeg",
    new AbortController().signal,
  );

  assert.equal(result.text, "Q1 A) Alpha B) Beta");
  assert.equal(result.responseId, "vision-ray");
  assert.equal(
    captured?.url,
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/%40cf/moondream/moondream3.1-9B-A2B`,
  );
  assert.equal(captured?.body.task, "query");
  assert.equal(captured?.body.stream, false);
  assert.equal(captured?.body.reasoning, false);
  assert.match(String(captured?.body.image), /^data:image\/jpeg;base64,/u);
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

test("scanned PDF reads only the required PNG pages without re-uploading the whole PDF", async () => {
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
      "image/png",
      "image/png",
      "image/png",
      "image/png",
    ]);
    assert.deepEqual(calls.map((call) => call.filename), [
      "source-page-1.png",
      "source-page-2.png",
      "source-page-3.png",
      "source-page-4.png",
    ]);
    assert.ok(calls.every((call) =>
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
  for (let index = 0; index < 25; index += 1) document.addPage([612, 792]);
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
      const pages: Awaited<ReturnType<typeof renderPDFPages>> = [];
      await forEachRenderedPDFPage(
        prepared.input.pdf.fileSource.capability,
        prepared.input.pdf.source,
        prepared.input.pdf.pageCount,
        { startPage: 22, endPage: 24, maxPages: 2 },
        async (page) => {
          pages.push(page);
        },
      );
      assert.deepEqual(pages.map((page) => page.page), [22, 23, 24]);
      assert.ok(pages.every((page) => page.mimeType === "image/png" && page.bytes.length > 100));
      assert.deepEqual(pages.map((page) => page.source.page), [22, 23, 24]);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mixed PDFs keep the local text layer and OCR only image-heavy pages", async () => {
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

    assert.equal(result[0]?.text, "Text-layer page");
    assert.deepEqual(result.filter((part) => part.page !== undefined).map((part) => part.page), [1, 2]);
    assert.deepEqual(calls, ["image/png:source-page-2.png"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function semanticScannedPDF(pageCount = 4, lastPageMarker = false): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const canvas = createCanvas(1600, 2200);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "black";
    context.font = "48px sans-serif";
    if (lastPageMarker && pageIndex === pageCount - 1) {
      context.fillText("LAST-PAGE-MARKER", 90, 100);
    }
    const firstQuestion = pageIndex * 5 + 1;
    for (let offset = 0; offset < 5; offset += 1) {
      const question = firstQuestion + offset;
      const y = 180 + offset * 390;
      context.fillText(`Q${question} Which answer is correct?`, 90, y);
      context.fillText("A) Alpha", 130, y + 70);
      context.fillText("B) Beta", 130, y + 130);
      context.fillText("C) Gamma", 130, y + 190);
      context.fillText("D) Delta", 130, y + 250);
      context.fillText(`Ans: ${["A", "B", "C", "D"][question % 4]}`, 130, y + 320);
    }
    const image = await document.embedPng(canvas.toBuffer("image/png"));
    const page = document.addPage([612, 792]);
    page.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  }
  return new Uint8Array(await document.save());
}

test("image-only semantic PDF reaches all visual pages and normalizes Q1-Q20", async () => {
  const pdfBytes = await semanticScannedPDF();
  const root = await mkdtemp(join(tmpdir(), "cloudflare-semantic-pdf-"));
  const markdownCalls: Array<{ mimeType: string; filename: string; bytes: Uint8Array }> = [];
  const runCalls: string[] = [];
  const client = {
    toMarkdown: async (bytes: Uint8Array, mimeType: string, filename: string) => {
      markdownCalls.push({ bytes, mimeType, filename });
      if (mimeType === "application/pdf") return { data: "", format: "markdown" };
      const page = Number(filename.match(/page-(\d+)/u)?.[1]);
      const firstQuestion = (page - 1) * 5 + 1;
      return {
        data: Array.from({ length: 5 }, (_, offset) => `Q${firstQuestion + offset} A) Alpha B) Beta C) Gamma D) Delta`).join("\n"),
        format: "markdown",
      };
    },
    run: async (messages: Array<{ role: string; content: string }>) => {
      const userContent = messages.find((message) => message.role === "user")?.content ?? "";
      runCalls.push(userContent);
      assert.match(userContent, /\[Source document page 4\]/u);
      assert.match(userContent, /Q20/u);
      const items = Array.from({ length: 20 }, (_, index) => {
        const question = index + 1;
        return {
          sourceOrdinal: question,
          question: `Q${question} Which answer is correct?`,
          options: ["Alpha", "Beta", "Gamma", "Delta"],
          correctAnswer: ["A", "B", "C", "D"][question % 4],
          hint: null,
          explanation: null,
          difficulty: "Medium",
          source: {
            inputType: "pdf",
            page: Math.ceil(question / 5),
            supportingExcerpt: `Q${question}`,
          },
          confidence: 0.95,
          uncertainties: [],
        };
      });
      return {
        text: JSON.stringify({ items, skippedItems: [], truncated: false, uncertainties: [] }),
        responseId: "semantic-pdf-test",
      };
    },
  };
  try {
    const converter = new CloudflareMarkdownConverter(client as never);
    const provider = new CloudflareAIProvider(
      { ...config, chunkChars: 100_000 },
      client as never,
      converter,
    );
    const engine = new MCQAIEngine(
      new AIContentService(provider, { maxProviderAttempts: 1, retryBaseDelayMs: 0 }),
    );
    const input = new AIInputService({}, new AITemporaryFileManager(root));
    const result = await input.withPreparedInput({
      kind: "pdf",
      file: {
        bytes: pdfBytes,
        claimedMimeType: "application/pdf",
        originalFilename: "semantic-scan.pdf",
      },
    }, (prepared) => engine.extractExistingMCQs(prepared));

    assert.equal(preparedPageCount(result.items), 4);
    assert.equal(result.items.length, 20);
    assert.deepEqual(result.items.map((item) => item.sourceOrdinal), Array.from({ length: 20 }, (_, index) => index + 1));
    assert.deepEqual(
      result.items.map((item) => item.source?.page),
      Array.from({ length: 20 }, (_, index) => Math.ceil((index + 1) / 5)),
    );
    assert.equal(new Set(result.items.map((item) => item.question)).size, 20);
    assert.equal(markdownCalls.length, 4);
    assert.deepEqual(markdownCalls.map((call) => call.filename), [
      "source-page-1.png",
      "source-page-2.png",
      "source-page-3.png",
      "source-page-4.png",
    ]);
    assert.ok(markdownCalls.every((call) =>
      call.mimeType === "image/png" &&
      call.bytes[0] === 0x89 &&
      call.bytes[1] === 0x50 &&
      call.bytes.length > 10_000,
    ));
    assert.equal(runCalls.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function preparedPageCount(items: Array<{ source?: { page?: number } | null }>): number {
  return new Set(items.map((item) => item.source?.page).filter((page): page is number => page !== undefined)).size;
}

test("portable visual windows cover all 25 pages and retain a page-25 marker", async () => {
  const pdfBytes = await semanticScannedPDF(25, true);
  const root = await mkdtemp(join(tmpdir(), "cloudflare-25-page-pdf-"));
  const pages: number[] = [];
  const calls: string[] = [];
  const client = {
    toMarkdown: async (_bytes: Uint8Array, mimeType: string, filename: string) => {
      calls.push(`${mimeType}:${filename}`);
      if (mimeType === "application/pdf") return { data: "", format: "markdown" };
      const page = Number(filename.match(/page-(\d+)/u)?.[1]);
      pages.push(page);
      return { data: page === 25 ? "LAST-PAGE-MARKER" : `page-${page}`, format: "markdown" };
    },
  };
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = "";
    const converter = new CloudflareMarkdownConverter(client as never);
    const input = new AIInputService({}, new AITemporaryFileManager(root));
    const result = await input.withPreparedInput({
      kind: "pdf",
      file: { bytes: pdfBytes, claimedMimeType: "application/pdf", originalFilename: "25-page-scan.pdf" },
    }, (prepared) => converter.convert(prepared.contents, new AbortController().signal));
    assert.deepEqual(pages, Array.from({ length: 25 }, (_, index) => index + 1));
    assert.equal(new Set(pages).size, 25);
    assert.equal(result.at(-1)?.text, "LAST-PAGE-MARKER");
    assert.equal(calls.length, 25);
  } finally {
    process.env.PATH = originalPath;
    await rm(root, { recursive: true, force: true });
  }
});

test("image-only semantic PDF reaches Flashcard extraction with page evidence", async () => {
  const pdfBytes = await semanticScannedPDF();
  const root = await mkdtemp(join(tmpdir(), "cloudflare-semantic-flashcard-"));
  const visualPages: number[] = [];
  const client = {
    toMarkdown: async (bytes: Uint8Array, mimeType: string, filename: string) => {
      if (mimeType === "image/png") {
        assert.equal(bytes[0], 0x89);
        visualPages.push(Number(filename.match(/page-(\d+)/u)?.[1]));
      }
      return {
        data: mimeType === "application/pdf"
          ? ""
          : `Page ${filename} contains visual clinical concept and answer pairs.`,
        format: "markdown",
      };
    },
    run: async (messages: Array<{ role: string; content: string }>) => {
      const userContent = messages.find((message) => message.role === "user")?.content ?? "";
      assert.match(userContent, /\[Source document page 4\]/u);
      return {
        text: JSON.stringify({
          items: Array.from({ length: 4 }, (_, index) => ({
            clinicalConcept: `Visual concept ${index + 1}`,
            explanation: `Visual answer ${index + 1}`,
            source: { inputType: "pdf", page: index + 1, supportingExcerpt: `Page ${index + 1}` },
            confidence: 0.95,
            uncertainties: [],
          })),
          skippedItems: [],
          truncated: false,
          uncertainties: [],
        }),
        responseId: "semantic-flashcard-test",
      };
    },
  };
  try {
    const provider = new CloudflareAIProvider(
      { ...config, chunkChars: 100_000 },
      client as never,
      new CloudflareMarkdownConverter(client as never),
    );
    const engine = new FlashcardAIEngine(
      new AIContentService(provider, { maxProviderAttempts: 1, retryBaseDelayMs: 0 }),
    );
    const input = new AIInputService({}, new AITemporaryFileManager(root));
    const result = await input.withPreparedInput({
      kind: "pdf",
      file: { bytes: pdfBytes, claimedMimeType: "application/pdf", originalFilename: "flashcards.pdf" },
    }, (prepared) => engine.extractExistingFlashcards(prepared));

    assert.equal(result.items.length, 4);
    assert.deepEqual(visualPages, [1, 2, 3, 4]);
    assert.deepEqual(result.items.map((item) => item.source?.page), [1, 2, 3, 4]);
    assert.equal(result.items.every((item) => item.clinicalConcept && item.explanation), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MCQ and Flashcard generation receive source evidence from both ends of a visual PDF", async () => {
  const pdfBytes = await semanticScannedPDF(4, true);
  const root = await mkdtemp(join(tmpdir(), "cloudflare-generation-coverage-"));
  let runCount = 0;
  const client = {
    toMarkdown: async (bytes: Uint8Array, mimeType: string) => {
      if (mimeType === "image/png") assert.equal(bytes[0], 0x89);
      return { data: mimeType === "application/pdf" ? "" : "visual source", format: "markdown" };
    },
    run: async (messages: Array<{ role: string; content: string }>) => {
      const userContent = messages.find((message) => message.role === "user")?.content ?? "";
      assert.match(userContent, /\[Source document page 1\]/u);
      assert.match(userContent, /\[Source document page 4\]/u);
      runCount += 1;
      const source = { inputType: "pdf", page: 4, supportingExcerpt: "LAST-PAGE-MARKER" };
      const text = runCount === 1
        ? {
          items: [
            {
              question: "What appears on the final page?",
              optionA: "Nothing",
              optionB: "A final-page marker",
              optionC: "Only metadata",
              optionD: "An empty page",
              correctAnswer: "B",
              hint: null,
              explanation: "The final page contains the marker.",
              difficulty: "Easy",
              source,
              confidence: 0.95,
              uncertainties: [],
            },
            {
              question: "What appears on the first page?",
              optionA: "An early-page question",
              optionB: "Nothing",
              optionC: "Only metadata",
              optionD: "An empty page",
              correctAnswer: "A",
              hint: null,
              explanation: "The first page contains the early source.",
              difficulty: "Easy",
              source: { inputType: "pdf", page: 1, supportingExcerpt: "Q1" },
              confidence: 0.95,
              uncertainties: [],
            },
          ],
          uncertainties: [],
        }
        : {
          items: [
            {
              clinicalConcept: "Final-page marker",
              explanation: "The final page contains the marker.",
              source,
              confidence: 0.95,
              uncertainties: [],
            },
            {
              clinicalConcept: "Early-page question",
              explanation: "The first page contains the early source.",
              source: { inputType: "pdf", page: 1, supportingExcerpt: "Q1" },
              confidence: 0.95,
              uncertainties: [],
            },
          ],
          uncertainties: [],
        };
      return { text: JSON.stringify(text), responseId: `generation-coverage-${runCount}` };
    },
  };
  try {
    const provider = new CloudflareAIProvider(
      { ...config, chunkChars: 100_000 },
      client as never,
      new CloudflareMarkdownConverter(client as never),
    );
    const content = new AIContentService(provider, { maxProviderAttempts: 1, retryBaseDelayMs: 0 });
    const mcqEngine = new MCQAIEngine(content);
    const flashcardEngine = new FlashcardAIEngine(content);
    const input = new AIInputService({}, new AITemporaryFileManager(root));
    await input.withPreparedInput({
      kind: "pdf",
      file: { bytes: pdfBytes, claimedMimeType: "application/pdf", originalFilename: "generation.pdf" },
    }, async (prepared) => {
      const mcqs = await mcqEngine.generateMCQs(prepared, {
        count: 2,
        questionStyle: "direct",
        includeHints: false,
        includeExplanations: true,
      });
      const flashcards = await flashcardEngine.generateFlashcards(prepared, { count: 2 });
      assert.deepEqual(mcqs.items.map((item) => item.source?.page).sort(), [1, 4]);
      assert.deepEqual(flashcards.items.map((item) => item.source?.page).sort(), [1, 4]);
    });
    assert.equal(runCount, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("portable renderer stops remaining pages after cancellation", async () => {
  const pdfBytes = await semanticScannedPDF();
  const root = await mkdtemp(join(tmpdir(), "cloudflare-cancel-pdf-"));
  const controller = new AbortController();
  const pages: number[] = [];
  try {
    const input = new AIInputService({}, new AITemporaryFileManager(root));
    await assert.rejects(
      input.withPreparedInput({
        kind: "pdf",
        file: { bytes: pdfBytes, claimedMimeType: "application/pdf", originalFilename: "cancel.pdf" },
      }, async (prepared) => {
        if (prepared.input.kind !== "pdf" || prepared.input.pdf.fileSource.kind !== "staged_file") {
          assert.fail("Expected staged PDF.");
        }
        await forEachRenderedPDFPage(
          prepared.input.pdf.fileSource.capability,
          prepared.input.pdf.source,
          prepared.input.pdf.pageCount,
          { maxPages: 20, signal: controller.signal },
          async (page) => {
            pages.push(page.page);
            controller.abort();
          },
        );
      }),
      (error: unknown) => error instanceof DOMException && error.name === "AbortError",
    );
    assert.deepEqual(pages, [1]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("portable renderer returns a safe error without leaving temporary page files", async () => {
  const root = await mkdtemp(join(tmpdir(), "cloudflare-render-failure-"));
  const manager = new AITemporaryFileManager(root);
  const staged = await manager.stage(new Uint8Array([0, 1, 2, 3]));
  try {
    await assert.rejects(
      renderPDFPages(
        staged.capability,
        { inputType: "pdf", label: "broken.pdf" },
        1,
        { maxPages: 1 },
      ),
      (error: unknown) => error instanceof AIServiceError && error.code === "AI_MEDIA_PROCESSING_FAILED",
    );
  } finally {
    await staged.dispose();
    assert.deepEqual(await readdir(root), []);
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