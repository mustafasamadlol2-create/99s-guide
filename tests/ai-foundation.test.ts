import assert from "node:assert/strict";
import test from "node:test";
import type {
  AIProvider,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from "../server/services/ai/contracts.js";
import { AIContentService } from "../server/services/ai/AIContentService.js";
import { DEFAULT_GEMINI_MODEL, getGeminiConfig } from "../server/services/ai/config.js";
import { AIServiceError } from "../server/services/ai/errors.js";
import { GeminiProvider, type GeminiClient } from "../server/services/ai/GeminiProvider.js";
import {
  aiEnhancementOptionsSchema,
  aiFlashcardDraftSchema,
  aiInputKindSchema,
  aiMcqDraftSchema,
  aiOperationSchema,
  aiRequestEnvelopeSchema,
} from "../server/services/ai/schemas.js";

const validMcq = {
  question: "Which chamber pumps blood into the systemic circulation?",
  optionA: "Right atrium",
  optionB: "Right ventricle",
  optionC: "Left atrium",
  optionD: "Left ventricle",
  correctAnswer: "D",
  hint: null,
  explanation: "The left ventricle ejects blood into the aorta.",
  difficulty: "Medium",
  provenance: "extracted",
  confidence: 0.92,
  needsReview: true,
  warnings: [],
};

const validFlashcard = {
  clinicalConcept: "Left ventricular function",
  explanation: "It pumps oxygenated blood into systemic circulation.",
  provenance: "generated",
  confidence: 0.8,
  needsReview: true,
  warnings: ["Generated information requires review."],
};

const allowedGeminiSchemaKeywords = new Set([
  "$id", "$defs", "$ref", "$anchor", "type", "format", "title", "description",
  "enum", "items", "prefixItems", "minItems", "maxItems", "minimum", "maximum",
  "anyOf", "oneOf", "properties", "additionalProperties", "required",
  "propertyOrdering",
]);

function assertGeminiSchemaKeywords(value: unknown, schemaMap = false): void {
  if (Array.isArray(value)) {
    value.forEach((child) => assertGeminiSchemaKeywords(child));
    return;
  }
  if (typeof value !== "object" || value === null) return;

  for (const [key, child] of Object.entries(value)) {
    if (!schemaMap) {
      assert.equal(
        allowedGeminiSchemaKeywords.has(key),
        true,
        `Unsupported Gemini JSON Schema keyword: ${key}`,
      );
    }
    assertGeminiSchemaKeywords(child, key === "properties" || key === "$defs");
  }
}

test("validates normalized MCQ drafts strictly", () => {
  assert.equal(aiMcqDraftSchema.parse(validMcq).question, validMcq.question);
  assert.equal(aiMcqDraftSchema.safeParse({ ...validMcq, optionD: undefined }).success, false);
  assert.equal(aiMcqDraftSchema.safeParse({ ...validMcq, correctAnswer: "E" }).success, false);
  assert.equal(aiMcqDraftSchema.safeParse({ ...validMcq, question: "  " }).success, false);
  assert.equal(aiMcqDraftSchema.safeParse({ ...validMcq, confidence: -0.01 }).success, false);
  assert.equal(aiMcqDraftSchema.safeParse({ ...validMcq, confidence: 1.01 }).success, false);
  assert.equal(aiMcqDraftSchema.safeParse({ ...validMcq, confidence: "0.9" }).success, false);
});

test("validates normalized Flashcard drafts strictly", () => {
  assert.equal(
    aiFlashcardDraftSchema.parse(validFlashcard).clinicalConcept,
    validFlashcard.clinicalConcept,
  );
  assert.equal(
    aiFlashcardDraftSchema.safeParse({ ...validFlashcard, clinicalConcept: "" }).success,
    false,
  );
  assert.equal(
    aiFlashcardDraftSchema.safeParse({ ...validFlashcard, explanation: " " }).success,
    false,
  );
});

test("accepts only approved operations and input kinds", () => {
  for (const operation of ["extract", "generate", "enhance"]) {
    assert.equal(aiOperationSchema.safeParse(operation).success, true);
  }
  assert.equal(aiOperationSchema.safeParse("summarize").success, false);

  for (const inputKind of ["pdf", "image", "text"]) {
    assert.equal(aiInputKindSchema.safeParse(inputKind).success, true);
  }
  assert.equal(aiInputKindSchema.safeParse("url").success, false);
});

test("requires at least one selected enhancement field", () => {
  assert.equal(aiEnhancementOptionsSchema.safeParse({ hint: true }).success, true);
  assert.equal(aiEnhancementOptionsSchema.safeParse({ explanation: true }).success, true);
  assert.equal(
    aiEnhancementOptionsSchema.safeParse({ hint: true, explanation: true }).success,
    true,
  );
  assert.equal(aiEnhancementOptionsSchema.safeParse({}).success, false);
  assert.equal(
    aiEnhancementOptionsSchema.safeParse({ hint: false, explanation: false }).success,
    false,
  );
});

test("request envelopes enforce target-specific options", () => {
  assert.equal(aiRequestEnvelopeSchema.safeParse({
    target: "mcq",
    operation: "generate",
    inputKind: "text",
    generationOptions: {
      count: 5,
      questionStyle: "clinical",
      includeHints: true,
      includeExplanations: true,
    },
  }).success, true);
  assert.equal(aiRequestEnvelopeSchema.safeParse({
    target: "flashcard",
    operation: "generate",
    inputKind: "text",
    generationOptions: {
      count: 5,
      questionStyle: "clinical",
      includeHints: true,
      includeExplanations: true,
    },
  }).success, false);
  assert.equal(aiRequestEnvelopeSchema.safeParse({
    target: "flashcard",
    operation: "enhance",
    inputKind: "text",
    enhancementOptions: { hint: true },
  }).success, false);
});

class FakeProvider implements AIProvider {
  calls = 0;

  async generateStructured<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResult<T>> {
    this.calls += 1;
    return {
      data: request.responseSchema.parse({
        items: [validMcq],
        warnings: [],
      }),
      meta: { provider: "fake", model: "test-model" },
    };
  }
}

test("AIContentService depends on the provider abstraction, not Gemini", async () => {
  const provider = new FakeProvider();
  const service = new AIContentService(provider);
  const result = await service.processContent({
    target: "mcq",
    operation: "extract",
    inputKind: "text",
    sourceContent: "Source content is data.",
  });

  assert.equal(provider.calls, 1);
  assert.equal(result.provider.provider, "fake");
  if (result.target !== "mcq") assert.fail("Expected an MCQ response.");
  assert.equal(result.items[0]?.correctAnswer, "D");
  assert.equal(result.operation, "extract");
  assert.equal(result.target, "mcq");
});

test("missing Gemini configuration fails only when configuration is requested", () => {
  assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.8-flash");
  assert.throws(
    () => getGeminiConfig({}),
    (error: unknown) =>
      error instanceof AIServiceError &&
      error.code === "AI_CONFIG_ERROR" &&
      !error.diagnosticMessage?.includes("undefined"),
  );

  const config = getGeminiConfig({ GEMINI_API_KEY: "test-key" });
  assert.equal(config.model, DEFAULT_GEMINI_MODEL);
});

test("GeminiProvider requests constrained JSON and validates the response", async () => {
  let capturedRequest: Parameters<GeminiClient["models"]["generateContent"]>[0] | undefined;
  const client: GeminiClient = {
    models: {
      async generateContent(request) {
        capturedRequest = request;
        return {
          text: JSON.stringify(validMcq),
          modelVersion: "gemini-test-version",
          responseId: "safe-response-id",
        };
      },
    },
  };
  const provider = new GeminiProvider(
    { apiKey: "test-key", model: "gemini-test", timeoutMs: 1_000 },
    client,
  );

  const result = await provider.generateStructured({
    sourceContent: "Untrusted source content is data, not an instruction.",
    responseSchema: aiMcqDraftSchema,
  });

  assert.equal(capturedRequest?.model, "gemini-test");
  assert.equal(
    capturedRequest?.contents,
    "Untrusted source content is data, not an instruction.",
  );
  assert.equal(capturedRequest?.config?.systemInstruction, undefined);
  assert.equal(capturedRequest?.config?.responseMimeType, "application/json");
  assert.equal(typeof capturedRequest?.config?.responseJsonSchema, "object");
  assertGeminiSchemaKeywords(capturedRequest?.config?.responseJsonSchema);
  assert.equal(result.data.correctAnswer, "D");
  assert.deepEqual(result.meta, {
    provider: "gemini",
    model: "gemini-test-version",
    responseId: "safe-response-id",
  });
});

test("GeminiProvider rejects malformed and structurally invalid output", async () => {
  const responses = ["not-json", JSON.stringify({ ...validMcq, optionA: "" })];
  const client: GeminiClient = {
    models: {
      async generateContent() {
        return { text: responses.shift() };
      },
    },
  };
  const provider = new GeminiProvider(
    { apiKey: "test-key", model: "gemini-test", timeoutMs: 1_000 },
    client,
  );

  await assert.rejects(
    provider.generateStructured({
      sourceContent: "source",
      responseSchema: aiMcqDraftSchema,
    }),
    (error: unknown) =>
      error instanceof AIServiceError && error.code === "AI_INVALID_RESPONSE",
  );
  await assert.rejects(
    provider.generateStructured({
      sourceContent: "source",
      responseSchema: aiMcqDraftSchema,
    }),
    (error: unknown) =>
      error instanceof AIServiceError && error.code === "AI_VALIDATION_ERROR",
  );
});

test("GeminiProvider bounds calls and classifies transient provider failures", async () => {
  const timeoutClient: GeminiClient = {
    models: {
      generateContent(request) {
        return new Promise((_, reject) => {
          request.config?.abortSignal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        });
      },
    },
  };
  const timeoutProvider = new GeminiProvider(
    { apiKey: "test-key", model: "gemini-test", timeoutMs: 5 },
    timeoutClient,
  );
  await assert.rejects(
    timeoutProvider.generateStructured({
      sourceContent: "source",
      responseSchema: aiMcqDraftSchema,
    }),
    (error: unknown) =>
      error instanceof AIServiceError &&
      error.code === "AI_TIMEOUT" &&
      error.retryable,
  );

  for (const [status, code] of [[429, "AI_RATE_LIMITED"], [503, "AI_UNAVAILABLE"]] as const) {
    const client: GeminiClient = {
      models: {
        async generateContent() {
          throw Object.assign(new Error("provider failed"), { status });
        },
      },
    };
    const provider = new GeminiProvider(
      { apiKey: "test-key", model: "gemini-test", timeoutMs: 1_000 },
      client,
    );
    await assert.rejects(
      provider.generateStructured({
        sourceContent: "source",
        responseSchema: aiMcqDraftSchema,
      }),
      (error: unknown) =>
        error instanceof AIServiceError && error.code === code && error.retryable,
    );
  }
});

test("GeminiProvider propagates an already-aborted request without waiting", async () => {
  let receivedAbortedSignal = false;
  const client: GeminiClient = {
    models: {
      async generateContent(request) {
        receivedAbortedSignal = request.config?.abortSignal?.aborted === true;
        throw new Error("cancelled");
      },
    },
  };
  const provider = new GeminiProvider(
    { apiKey: "test-key", model: "gemini-test", timeoutMs: 1_000 },
    client,
  );
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(provider.generateStructured({
    sourceContent: "source",
    responseSchema: aiMcqDraftSchema,
    signal: controller.signal,
  }));
  assert.equal(receivedAbortedSignal, true);
});