import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type {
  AIProvider,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from "../server/services/ai/contracts.js";
import { AIContentService } from "../server/services/ai/AIContentService.js";
import { AIServiceError } from "../server/services/ai/errors.js";
import type { PreparedAIInput } from "../server/services/ai/input/contracts.js";
import { AITemporaryFileManager } from "../server/services/ai/input/temporaryFiles.js";
import {
  DEFAULT_FLASHCARD_ENGINE_CONFIG,
  FlashcardAIEngine,
  flashcardEnhancementProviderResponseSchema,
  flashcardExtractionProviderResponseSchema,
  flashcardGenerationProviderResponseSchema,
} from "../server/services/ai/flashcard/index.js";

type ProviderResponse = Record<string, unknown>;

class QueueProvider implements AIProvider {
  readonly calls: StructuredGenerationRequest<unknown>[] = [];

  constructor(private readonly responses: ProviderResponse[]) {}

  async generateStructured<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResult<T>> {
    this.calls.push(request as StructuredGenerationRequest<unknown>);
    const response = this.responses.shift();
    if (!response) throw new Error("No fake provider response available.");
    return {
      data: request.responseSchema.parse(response),
      meta: { provider: "fake", model: "flashcard-test-model" },
    };
  }
}

const FIXED_ID = "00000000-0000-4000-8000-000000000001";

function preparedText(text = "Cardiology section: ventricular systole."): PreparedAIInput {
  return {
    input: {
      kind: "text",
      text: {
        kind: "text",
        origin: "pasted_text",
        text,
        mimeType: "text/plain",
        sizeBytes: Buffer.byteLength(text),
        sha256: "a".repeat(64),
        source: { inputType: "text", section: "Cardiology" },
      },
    },
    contents: [{
      kind: "text",
      text,
      source: { inputType: "text", section: "Cardiology" },
      sizeBytes: Buffer.byteLength(text),
      sha256: "a".repeat(64),
    }],
    dispose: async () => {},
  };
}

async function stagedPreparedFile(
  inputType: "pdf" | "image",
  imageCount = 1,
): Promise<{ input: PreparedAIInput; dispose: () => Promise<void> }> {
  const manager = new AITemporaryFileManager();
  const stagedFiles = await Promise.all(
    Array.from({ length: imageCount }, () => manager.stage(new Uint8Array([1, 2, 3]))),
  );
  const contents = stagedFiles.map((staged, imageIndex) => ({
    kind: "file" as const,
    inputType,
    mimeType: inputType === "pdf" ? "application/pdf" as const : "image/png" as const,
    fileSource: {
      kind: "staged_file" as const,
      capability: staged.capability,
      ownership: "owned_transient" as const,
    },
    source: inputType === "pdf"
      ? { inputType: "pdf" as const, page: 2, section: "Cardiology" }
      : { inputType: "image" as const, imageIndex },
    sizeBytes: staged.sizeBytes,
    sha256: `${imageIndex + 1}`.repeat(64),
  }));
  return {
    input: inputType === "pdf"
      ? {
        input: {
          kind: "pdf",
          pdf: {
            kind: "pdf",
            displayName: "lecture.pdf",
            mimeType: "application/pdf",
            sizeBytes: stagedFiles[0]!.sizeBytes,
            sha256: "1".repeat(64),
            source: { inputType: "pdf", page: 2, section: "Cardiology" },
            origin: "upload",
            ownership: "owned_transient",
            fileSource: {
              kind: "staged_file",
              capability: stagedFiles[0]!.capability,
              ownership: "owned_transient",
            },
          },
        },
        contents,
        dispose: () => manager.dispose(),
      }
      : {
        input: {
          kind: "image",
          images: contents.map((part, imageIndex) => ({
            kind: "image" as const,
            imageIndex,
            displayName: `image-${imageIndex}.png`,
            mimeType: "image/png" as const,
            sizeBytes: part.sizeBytes,
            sha256: part.sha256,
            source: { inputType: "image" as const, imageIndex },
            origin: "upload" as const,
            ownership: "owned_transient" as const,
            fileSource: part.fileSource,
          })),
        },
        contents,
        dispose: () => manager.dispose(),
      },
    dispose: () => manager.dispose(),
  };
}

function extractedItem(overrides: Record<string, unknown> = {}) {
  return {
    clinicalConcept: "Left ventricular function",
    explanation: "It pumps oxygenated blood into systemic circulation.",
    source: { inputType: "text", section: "Cardiovascular physiology" },
    confidence: 0.95,
    uncertainties: [],
    ...overrides,
  };
}

function extractionResponse(
  items = [extractedItem()],
  overrides: Record<string, unknown> = {},
) {
  return {
    items,
    skippedItems: [],
    truncated: false,
    uncertainties: [],
    ...overrides,
  };
}

function generatedItem(overrides: Record<string, unknown> = {}) {
  return {
    clinicalConcept: "What does the left ventricle pump?",
    explanation: "It pumps oxygenated blood into systemic circulation.",
    source: { inputType: "text", section: "Cardiovascular physiology" },
    confidence: 0.95,
    uncertainties: [],
    ...overrides,
  };
}

function generationResponse(
  items = [generatedItem()],
  overrides: Record<string, unknown> = {},
) {
  return { items, uncertainties: [], ...overrides };
}

function engineWith(provider: QueueProvider, config = DEFAULT_FLASHCARD_ENGINE_CONFIG) {
  return new FlashcardAIEngine(
    new AIContentService(provider),
    config,
    () => FIXED_ID,
  );
}

test("extract preserves complete cards, order, and medical wording", async () => {
  const provider = new QueueProvider([extractionResponse([
    extractedItem(),
    extractedItem({
      clinicalConcept: "ما وظيفة البطين الأيسر؟",
      explanation: "يضخ الدم المؤكسج إلى الدورة الجهازية.",
      source: { inputType: "text", section: "الدورة الدموية" },
    }),
    extractedItem({
      clinicalConcept: "Gram-positive cocci",
      explanation: "Cocci that retain crystal violet because of a thick peptidoglycan wall.",
    }),
  ])]);
  const result = await engineWith(provider).extractExistingFlashcards(preparedText());

  assert.deepEqual(result.items.map((item) => item.clinicalConcept), [
    "Left ventricular function",
    "ما وظيفة البطين الأيسر؟",
    "Gram-positive cocci",
  ]);
  assert.equal(result.items[0]?.explanation, "It pumps oxygenated blood into systemic circulation.");
  assert.equal(result.items[1]?.explanation, "يضخ الدم المؤكسج إلى الدورة الجهازية.");
  assert.equal(result.items[2]?.importReady, true);
  assert.equal(result.items.every((item) => item.requiresHumanApproval), true);
});

test("extract preserves front-only cards without inventing a back", async () => {
  const provider = new QueueProvider([extractionResponse([
    extractedItem({ explanation: null }),
  ])]);
  const result = await engineWith(provider).extractExistingFlashcards(preparedText());

  assert.equal(result.items[0]?.clinicalConcept, "Left ventricular function");
  assert.equal(result.items[0]?.explanation, null);
  assert.equal(result.items[0]?.importReady, false);
  assert.equal(result.items[0]?.needsReview, true);
  assert.ok(result.items[0]?.warnings.some((warning) => warning.includes("no explicit")));
});

test("extract skips a back without a reliably identifiable front", async () => {
  const provider = new QueueProvider([extractionResponse([
    extractedItem({ clinicalConcept: null }),
  ])]);
  const result = await engineWith(provider).extractExistingFlashcards(preparedText());

  assert.equal(result.items.length, 0);
  assert.equal(result.skippedItems[0]?.reason, "missing_front");
  assert.equal(result.counts.skippedCount, 1);
});

test("extract reports unsupported and unreadable source items", async () => {
  const provider = new QueueProvider([extractionResponse([], {
    skippedItems: [
      { reason: "unsupported_format", source: null, summary: "Matching exercise." },
      { reason: "unreadable", source: null, summary: "Image text is unreadable." },
      { reason: "not_flashcard", source: null, summary: "Narrative paragraph." },
    ],
  })]);
  const result = await engineWith(provider).extractExistingFlashcards(preparedText());

  assert.deepEqual(result.skippedItems.map((item) => item.reason), [
    "unsupported_format",
    "unreadable",
    "not_flashcard",
  ]);
});

test("extract validates PDF evidence and truncates at the configured limit", async () => {
  const prepared = await stagedPreparedFile("pdf");
  try {
    const provider = new QueueProvider([extractionResponse([
      extractedItem({ source: { inputType: "pdf", page: 2, section: "Cardiology" } }),
      extractedItem({ clinicalConcept: "Second card" }),
    ])]);
    const result = await engineWith(provider, {
      ...DEFAULT_FLASHCARD_ENGINE_CONFIG,
      extractionMaxCount: 1,
    }).extractExistingFlashcards(prepared.input);

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.source?.page, 2);
    assert.equal(result.truncated, true);
    assert.ok(result.warnings.some((warning) => warning.includes("truncated")));
  } finally {
    await prepared.dispose();
  }
});

test("extract validates image indexes against the actual prepared images", async () => {
  const prepared = await stagedPreparedFile("image", 2);
  try {
    const provider = new QueueProvider([extractionResponse([
      extractedItem({ source: { inputType: "image", imageIndex: 7 } }),
    ])]);
    const result = await engineWith(provider).extractExistingFlashcards(prepared.input);

    assert.equal(result.items[0]?.source?.imageIndex, undefined);
    assert.equal(result.items[0]?.needsReview, true);
    assert.ok(result.items[0]?.warnings.some((warning) => warning.includes("invalid image index")));
  } finally {
    await prepared.dispose();
  }
});

test("extract flags input-type mismatches instead of trusting provider evidence", async () => {
  const provider = new QueueProvider([extractionResponse([
    extractedItem({ source: { inputType: "pdf", page: 3 } }),
  ])]);
  const result = await engineWith(provider).extractExistingFlashcards(preparedText());

  assert.equal(result.items[0]?.source, null);
  assert.equal(result.items[0]?.needsReview, true);
  assert.ok(result.items[0]?.warnings.some((warning) => warning.includes("input type")));
});

test("generation creates complete source-grounded cards with a bounded focus", async () => {
  const provider = new QueueProvider([generationResponse()]);
  const result = await engineWith(provider).generateFlashcards(preparedText(), {
    count: 1,
    focus: "high-yield cardiovascular mechanisms",
  });

  assert.equal(result.items[0]?.clinicalConcept, "What does the left ventricle pump?");
  assert.equal(result.items[0]?.explanation, "It pumps oxygenated blood into systemic circulation.");
  assert.equal(result.items[0]?.importReady, true);
  assert.equal(result.counts.requestedCount, 1);
  assert.match(provider.calls[0]?.trustedSystemInstruction ?? "", /one coherent learning point/i);
  assert.match(provider.calls[0]?.trustedSystemInstruction ?? "", /high-yield cardiovascular mechanisms/);
  assert.doesNotMatch(provider.calls[0]?.trustedSystemInstruction ?? "", /Cardiology section/);
});

test("generation supports the default and maximum count, and rejects values above 100", async () => {
  const defaultProvider = new QueueProvider([generationResponse()]);
  const defaultResult = await engineWith(defaultProvider).generateFlashcards(preparedText());
  assert.equal(defaultResult.counts.requestedCount, 20);

  const maxProvider = new QueueProvider([generationResponse()]);
  const maxResult = await engineWith(maxProvider).generateFlashcards(preparedText(), { count: 100 });
  assert.equal(maxResult.counts.requestedCount, 100);

  const invalidProvider = new QueueProvider([]);
  await assert.rejects(
    engineWith(invalidProvider).generateFlashcards(preparedText(), { count: 101 }),
    (error: unknown) => error instanceof AIServiceError && error.code === "AI_VALIDATION_ERROR",
  );
  assert.equal(invalidProvider.calls.length, 0);
});

test("generation warns when fewer cards are returned and rejects oversized focus", async () => {
  const provider = new QueueProvider([generationResponse()]);
  const result = await engineWith(provider).generateFlashcards(preparedText(), { count: 4 });
  assert.ok(result.warnings.some((warning) => warning.includes("only 1")));

  await assert.rejects(
    engineWith(new QueueProvider([])).generateFlashcards(preparedText(), { focus: "x".repeat(201) }),
    (error: unknown) => error instanceof AIServiceError && error.code === "AI_VALIDATION_ERROR",
  );
});

test("generation quality gates flag near-duplicate, meaningless, and low-confidence cards", async () => {
  const provider = new QueueProvider([generationResponse([
    generatedItem({
      clinicalConcept: "Concept",
      explanation: "Concept",
      confidence: 0.4,
    }),
  ])]);
  const result = await engineWith(provider).generateFlashcards(preparedText(), { count: 1 });
  const warnings = result.items[0]?.warnings.join(" ") ?? "";

  assert.equal(result.items[0]?.needsReview, true);
  assert.match(warnings, /not meaningful/);
  assert.match(warnings, /repeats the concept/);
  assert.match(warnings, /below the review threshold/);
});

test("generation flags duplicate fronts without deleting candidates", async () => {
  const provider = new QueueProvider([generationResponse([
    generatedItem(),
    generatedItem({ explanation: "A different supported explanation." }),
  ])]);
  const result = await engineWith(provider).generateFlashcards(preparedText(), { count: 2 });

  assert.equal(result.items.length, 2);
  assert.equal(result.items.every((item) => item.needsReview), true);
  assert.equal(result.items.every((item) => item.warnings.some((warning) => warning.includes("duplicates another"))), true);
});

test("enhancement fills only missing explanations and preserves existing cards", async () => {
  const provider = new QueueProvider([
    extractionResponse([
      extractedItem({ explanation: null }),
      extractedItem({ clinicalConcept: "Existing front", explanation: "Existing explanation" }),
    ]),
    {
      items: [{
        candidateId: FIXED_ID,
        explanation: "Generated explanation from the source.",
        confidence: 0.94,
        uncertainties: [],
      }],
      uncertainties: [],
    },
  ]);
  const result = await engineWith(provider).enhanceExistingFlashcards(preparedText());

  assert.equal(provider.calls.length, 2);
  assert.equal(result.items[0]?.explanation, "Generated explanation from the source.");
  assert.equal(result.items[0]?.clinicalConcept, "Left ventricular function");
  assert.equal(result.items[1]?.explanation, "Existing explanation");
  assert.equal(result.items[1]?.clinicalConcept, "Existing front");
  assert.match(provider.calls[1]?.trustedSystemInstruction ?? "", /missing explanations/i);
  assert.doesNotMatch(provider.calls[1]?.trustedSystemInstruction ?? "", /Left ventricular function/);
  assert.ok(provider.calls[1]?.additionalUntrustedContext?.includes("Left ventricular function"));
});

test("enhancement flags unknown IDs and preserves eligible cards with missing results", async () => {
  const provider = new QueueProvider([
    extractionResponse([extractedItem({ explanation: null })]),
    {
      items: [{
        candidateId: randomUUID(),
        explanation: "Unknown candidate explanation.",
        confidence: 0.99,
        uncertainties: [],
      }],
      uncertainties: [],
    },
  ]);
  const result = await engineWith(provider).enhanceExistingFlashcards(preparedText());

  assert.ok(result.warnings.some((warning) => warning.includes("unknown candidate ID")));
  assert.ok(result.items[0]?.warnings.some((warning) => warning.includes("No explanation enhancement")));
  assert.equal(result.items[0]?.explanation, null);
  assert.equal(result.items[0]?.importReady, false);
});

test("enhancement makes only front-only cards eligible and does not call Stage 2 otherwise", async () => {
  const provider = new QueueProvider([extractionResponse([
    extractedItem({ explanation: "Already complete." }),
  ])]);
  const result = await engineWith(provider).enhanceExistingFlashcards(preparedText());

  assert.equal(provider.calls.length, 1);
  assert.ok(result.warnings.some((warning) => warning.includes("No extracted Flashcards")));
  assert.equal(result.items[0]?.explanation, "Already complete.");
});

test("enhancement Stage 2 schema cannot write the immutable front", () => {
  const parsed = flashcardEnhancementProviderResponseSchema.safeParse({
    items: [{
      candidateId: randomUUID(),
      explanation: "Allowed field",
      clinicalConcept: "Attempted rewrite",
      confidence: 0.9,
      uncertainties: [],
    }],
    uncertainties: [],
  });
  assert.equal(parsed.success, false);
});

test("provider schemas remain operation-specific and strict", () => {
  assert.equal(flashcardExtractionProviderResponseSchema.safeParse({
    items: [extractedItem()],
    skippedItems: [],
    truncated: false,
    uncertainties: [],
  }).success, true);
  assert.equal(flashcardGenerationProviderResponseSchema.safeParse({
    items: [generatedItem()],
    uncertainties: [],
  }).success, true);
  assert.equal(flashcardGenerationProviderResponseSchema.safeParse({
    items: [{ ...generatedItem(), explanation: null }],
    uncertainties: [],
  }).success, false);
});
