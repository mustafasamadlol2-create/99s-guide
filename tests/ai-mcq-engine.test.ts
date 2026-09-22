import assert from "node:assert/strict";
import test from "node:test";
import type { ZodType } from "zod";
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
  MCQAIEngine,
  createMCQEnhancementProviderResponseSchema,
  mcqEnhancementProviderResponseSchema,
  mcqExtractionProviderResponseSchema,
  mcqGenerationProviderResponseSchema,
  type MCQOperationResult,
} from "../server/services/ai/mcq/index.js";

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
      meta: { provider: "fake", model: "mcq-test-model" },
    };
  }
}

const testCapability = async () => {
  const manager = new AITemporaryFileManager();
  const staged = await manager.stage(new Uint8Array([1, 2, 3]));
  return { manager, staged };
};

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

async function preparedImage(): Promise<{ input: PreparedAIInput; dispose: () => Promise<void> }> {
  const first = await testCapability();
  const second = await testCapability();
  const contents = [first.staged, second.staged].map((staged, imageIndex) => ({
    kind: "file" as const,
    inputType: "image" as const,
    mimeType: "image/png" as const,
    fileSource: {
      kind: "staged_file" as const,
      capability: staged.capability,
      ownership: "owned_transient" as const,
    },
    source: { inputType: "image" as const, imageIndex },
    sizeBytes: staged.sizeBytes,
    sha256: `${imageIndex}`.repeat(64),
  }));
  return {
    input: {
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
      dispose: async () => {
        await first.staged.dispose();
        await second.staged.dispose();
      },
    },
    dispose: async () => {
      await first.staged.dispose();
      await second.staged.dispose();
    },
  };
}

async function preparedPdf(): Promise<PreparedAIInput> {
  const staged = await testCapability();
  return {
    input: {
      kind: "pdf",
      pdf: {
        kind: "pdf",
        displayName: "lecture.pdf",
        mimeType: "application/pdf",
        sizeBytes: staged.staged.sizeBytes,
        sha256: "b".repeat(64),
        source: { inputType: "pdf", page: 4, section: "Cardiology" },
        origin: "upload",
        ownership: "owned_transient",
        fileSource: {
          kind: "staged_file",
          capability: staged.staged.capability,
          ownership: "owned_transient",
        },
      },
    },
    contents: [{
      kind: "file",
      inputType: "pdf",
      mimeType: "application/pdf",
      fileSource: {
        kind: "staged_file",
        capability: staged.staged.capability,
        ownership: "owned_transient",
      },
      source: { inputType: "pdf", page: 4, section: "Cardiology" },
      sizeBytes: staged.staged.sizeBytes,
      sha256: "b".repeat(64),
    }],
    dispose: staged.staged.dispose,
  };
}

function extractedItem(overrides: Record<string, unknown> = {}) {
  return {
    question: "Which chamber pumps blood into systemic circulation?",
    options: ["Right atrium", "Right ventricle", "Left atrium", "Left ventricle"],
    correctAnswer: "D",
    hint: "Think about the chamber connected to the aorta.",
    explanation: "The left ventricle ejects blood into the aorta.",
    difficulty: "Medium",
    source: { inputType: "text", section: "Cardiovascular physiology" },
    confidence: 0.95,
    uncertainties: [],
    ...overrides,
  };
}

function generatedItem(overrides: Record<string, unknown> = {}) {
  return {
    question: "Which chamber pumps blood into systemic circulation?",
    optionA: "Right atrium",
    optionB: "Right ventricle",
    optionC: "Left atrium",
    optionD: "Left ventricle",
    correctAnswer: "D",
    hint: "Identify the chamber connected to the aorta.",
    explanation: "The left ventricle ejects oxygenated blood into the aorta.",
    difficulty: "Medium",
    source: { inputType: "text", section: "Cardiovascular physiology" },
    confidence: 0.95,
    uncertainties: [],
    ...overrides,
  };
}

function extractionResponse(items = [extractedItem()], overrides: Record<string, unknown> = {}) {
  return {
    items,
    skippedItems: [],
    truncated: false,
    uncertainties: [],
    ...overrides,
  };
}

function generationResponse(items = [generatedItem()], overrides: Record<string, unknown> = {}) {
  return { items, uncertainties: [], ...overrides };
}

function engineWith(provider: QueueProvider) {
  return new MCQAIEngine(new AIContentService(provider), undefined, () => crypto.randomUUID());
}

test("extract preserves complete MCQs and does not rewrite source fields", async () => {
  const provider = new QueueProvider([extractionResponse()]);
  const result = await engineWith(provider).extractExistingMCQs(preparedText());

  assert.equal(result.operation, "extract");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.question, "Which chamber pumps blood into systemic circulation?");
  assert.equal(result.items[0]?.optionA, "Right atrium");
  assert.equal(result.items[0]?.optionD, "Left ventricle");
  assert.equal(result.items[0]?.correctAnswer, "D");
  assert.equal(result.items[0]?.hint, "Think about the chamber connected to the aorta.");
  assert.equal(result.items[0]?.explanation, "The left ventricle ejects blood into the aorta.");
  assert.equal(result.items[0]?.difficulty, "Medium");
  assert.equal(result.items[0]?.category, "AI_GENERATED");
  assert.equal(result.items[0]?.importReady, true);
  assert.equal(result.items[0]?.requiresHumanApproval, true);
  assert.equal(result.items[0]?.needsReview, false);
});

test("extract applies the administrator metadata defaults", async () => {
  const provider = new QueueProvider([extractionResponse()]);
  const result = await engineWith(provider).extractExistingMCQs(
    preparedText(),
    undefined,
    { category: "PREVIOUS_YEAR", difficulty: "Hard" },
  );
  assert.equal(result.items[0]?.category, "PREVIOUS_YEAR");
  assert.equal(result.items[0]?.difficulty, "Hard");
});

test("extract keeps an unstated answer null and marks the candidate for review", async () => {
  const provider = new QueueProvider([extractionResponse([
    extractedItem({ correctAnswer: null, hint: null, explanation: null }),
  ])]);
  const result = await engineWith(provider).extractExistingMCQs(preparedText());

  assert.equal(result.items[0]?.correctAnswer, null);
  assert.equal(result.items[0]?.hint, null);
  assert.equal(result.items[0]?.explanation, null);
  assert.equal(result.items[0]?.importReady, false);
  assert.equal(result.items[0]?.needsReview, true);
  assert.ok(result.items[0]?.warnings.some((warning) => warning.includes("explicitly")));
});

test("extract reports unsupported option counts instead of distorting them", async () => {
  const provider = new QueueProvider([extractionResponse([
    extractedItem({
      options: ["A", "B", "C", "D", "E"],
    }),
  ])]);
  const result = await engineWith(provider).extractExistingMCQs(preparedText());

  assert.equal(result.items.length, 0);
  assert.equal(result.skippedItems[0]?.reason, "unsupported_option_count");
  assert.equal(result.counts.skippedCount, 1);
});

test("extract validates image evidence against the actual image count", async () => {
  const prepared = await preparedImage();
  try {
    const provider = new QueueProvider([extractionResponse([
      extractedItem({
        source: { inputType: "image", imageIndex: 7 },
      }),
    ])]);
    const result = await engineWith(provider).extractExistingMCQs(prepared.input);

    assert.equal(result.items[0]?.source?.inputType, "image");
    assert.equal(result.items[0]?.source?.imageIndex, undefined);
    assert.ok(result.items[0]?.warnings.some((warning) => warning.includes("invalid image index")));
    assert.equal(result.items[0]?.needsReview, true);
  } finally {
    await prepared.dispose();
  }
});

test("the engine accepts prepared PDF input and retains page evidence", async () => {
  const prepared = await preparedPdf();
  try {
    const provider = new QueueProvider([extractionResponse([
      extractedItem({ source: { inputType: "pdf", page: 4, section: "Cardiology" } }),
    ])]);
    const result = await engineWith(provider).extractExistingMCQs(prepared);

    assert.equal(result.items[0]?.source?.inputType, "pdf");
    assert.equal(result.items[0]?.source?.page, 4);
  } finally {
    await prepared.dispose();
  }
});

test("binary extraction retries one zero-result pass and labels unresolved visual coverage incomplete", async () => {
  const prepared = await preparedImage();
  try {
    const provider = new QueueProvider([
      extractionResponse([]),
      extractionResponse([]),
    ]);
    const result = await engineWith(provider).extractExistingMCQs(prepared.input);

    assert.equal(provider.calls.length, 2);
    assert.equal(result.items.length, 0);
    assert.equal(result.status, "incomplete");
    assert.ok(result.warnings.some((warning) => warning.includes("remained incomplete")));
  } finally {
    await prepared.dispose();
  }
});

test("binary extraction keeps candidates returned by the bounded recovery pass", async () => {
  const prepared = await preparedImage();
  try {
    const provider = new QueueProvider([
      extractionResponse([]),
      extractionResponse([extractedItem({ source: { inputType: "image", imageIndex: 0 } })]),
    ]);
    const result = await engineWith(provider).extractExistingMCQs(prepared.input);

    assert.equal(provider.calls.length, 2);
    assert.equal(result.items.length, 1);
    assert.equal(result.status, "complete");
    assert.equal(result.items[0]?.source?.inputType, "image");
  } finally {
    await prepared.dispose();
  }
});

test("generation supports styles, optional fields, source grounding and human approval", async () => {
  const provider = new QueueProvider([generationResponse([
    generatedItem({ hint: null, explanation: null }),
  ])]);
  const result = await engineWith(provider).generateMCQs(preparedText(), {
    count: 20,
    difficulty: "mixed",
    questionStyle: "clinical",
    includeHints: false,
    includeExplanations: false,
  });

  assert.equal(result.items[0]?.provenance, "generated");
  assert.equal(result.items[0]?.hint, null);
  assert.equal(result.items[0]?.explanation, null);
  assert.equal(result.counts.requestedCount, 20);
  assert.equal(result.items[0]?.requiresHumanApproval, true);
  assert.ok(result.warnings.some((warning) => warning.includes("only 1")));
  assert.match(provider.calls[0]?.trustedSystemInstruction ?? "", /source-grounded/i);
  assert.match(provider.calls[0]?.trustedSystemInstruction ?? "", /clinical/i);
  assert.doesNotMatch(provider.calls[0]?.trustedSystemInstruction ?? "", /Cardiology section/);
});

test("generation consumes direct visual source media", async () => {
  const prepared = await preparedImage();
  try {
    const provider = new QueueProvider([generationResponse([
      generatedItem({ source: { inputType: "image", imageIndex: 0 } }),
    ])]);
    const result = await engineWith(provider).generateMCQs(prepared.input, {
      count: 1,
      questionStyle: "direct",
      includeHints: true,
      includeExplanations: true,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.source?.inputType, "image");
    assert.equal(provider.calls.length, 1);
  } finally {
    await prepared.dispose();
  }
});

test("generation rejects counts above the approved maximum before provider use", async () => {
  const provider = new QueueProvider([]);
  await assert.rejects(
    engineWith(provider).generateMCQs(preparedText(), {
      count: 101,
      questionStyle: "direct",
      includeHints: false,
      includeExplanations: false,
    }),
    (error: unknown) => error instanceof AIServiceError && error.code === "AI_VALIDATION_ERROR",
  );
  assert.equal(provider.calls.length, 0);
});

test("generation quality gates flag duplicate options, low confidence and hint leakage", async () => {
  const provider = new QueueProvider([generationResponse([
    generatedItem({
      optionD: "Right atrium",
      hint: "Answer is D; choose the left ventricle.",
      confidence: 0.5,
    }),
  ])]);
  const result = await engineWith(provider).generateMCQs(preparedText(), {
    count: 1,
    questionStyle: "direct",
    includeHints: true,
    includeExplanations: true,
  });
  const warnings = result.items[0]?.warnings.join(" ") ?? "";
  assert.equal(result.items[0]?.needsReview, true);
  assert.match(warnings, /identical/);
  assert.match(warnings, /reveal/);
  assert.match(warnings, /below the review threshold/);
});

test("generation assigns AI category and requires model difficulty classification", async () => {
  const provider = new QueueProvider([generationResponse([
    generatedItem({ difficulty: null }),
  ])]);
  const result = await engineWith(provider).generateMCQs(preparedText(), {
    count: 1,
    questionStyle: "direct",
    includeHints: false,
    includeExplanations: false,
  });
  assert.equal(result.items[0]?.category, "AI_GENERATED");
  assert.equal(result.items[0]?.importReady, false);
  assert.ok(result.items[0]?.warnings.some((warning) => warning.includes("classify")));
  assert.match(provider.calls[0]?.trustedSystemInstruction ?? "", /classify every generated item/i);
  assert.doesNotMatch(provider.calls[0]?.trustedSystemInstruction ?? "", /Difficulty control:/i);
});

test("generation flags exact duplicate questions within the current result only", async () => {
  const provider = new QueueProvider([generationResponse([
    generatedItem(),
    generatedItem({ optionA: "A different distractor" }),
  ])]);
  const result = await engineWith(provider).generateMCQs(preparedText(), {
    count: 2,
    questionStyle: "understanding",
    includeHints: true,
    includeExplanations: true,
  });
  assert.equal(result.items.every((item) => item.needsReview), true);
  assert.equal(result.items.every((item) =>
    item.warnings.some((warning) => warning.includes("duplicates another"))), true);
});

test("enhancement is two-stage and preserves immutable fields and existing fields", async () => {
  const provider = new QueueProvider([
    extractionResponse([extractedItem({
      hint: "Existing hint must remain.",
      explanation: null,
    })]),
    {
      items: [{
        candidateId: crypto.randomUUID(),
        hint: "Generated hint",
        confidence: 0.94,
        uncertainties: [],
      }],
      uncertainties: [],
    },
  ]);
  const engine = new MCQAIEngine(new AIContentService(provider), undefined, () => "00000000-0000-4000-8000-000000000001");
  const result = await engine.enhanceExistingMCQs(preparedText(), {
    hint: true,
    explanation: true,
  });

  assert.equal(provider.calls.length, 2);
  assert.match(provider.calls[1]?.trustedSystemInstruction ?? "", /requested missing field/i);
  assert.ok(provider.calls[1]?.additionalUntrustedContext?.includes("candidateId"));
  assert.doesNotMatch(provider.calls[1]?.trustedSystemInstruction ?? "", /Which chamber/);
  assert.equal(result.items[0]?.question, "Which chamber pumps blood into systemic circulation?");
  assert.equal(result.items[0]?.optionA, "Right atrium");
  assert.equal(result.items[0]?.correctAnswer, "D");
  assert.equal(result.items[0]?.hint, "Existing hint must remain.");
  assert.equal(result.items[0]?.explanation, null);
});

test("enhancement uses direct visual source evidence and reports completed status", async () => {
  const prepared = await preparedImage();
  try {
    const candidateId = "00000000-0000-4000-8000-000000000001";
    const provider = new QueueProvider([
      extractionResponse([extractedItem({
        hint: null,
        explanation: null,
        source: { inputType: "image", imageIndex: 0 },
      })]),
      {
        items: [{
          candidateId,
          hint: "Generated from the visual source.",
          explanation: "The visual source supports the answer.",
          confidence: 0.94,
          uncertainties: [],
        }],
        uncertainties: [],
      },
    ]);
    const result = await new MCQAIEngine(new AIContentService(provider), undefined, () => candidateId)
      .enhanceExistingMCQs(prepared.input, { hint: true, explanation: true });
    assert.equal(result.items[0]?.provenance, "enhanced");
    assert.equal(result.items[0]?.source?.inputType, "image");
    assert.equal(result.items[0]?.needsReview, false);
  } finally {
    await prepared.dispose();
  }
});

test("enhancement preserves administrator-selected external metadata", async () => {
  const provider = new QueueProvider([
    extractionResponse([extractedItem({ hint: null, explanation: null })]),
    {
      items: [{
        candidateId: crypto.randomUUID(),
        explanation: "A generated explanation.",
        confidence: 0.94,
        uncertainties: [],
      }],
      uncertainties: [],
    },
  ]);
  const result = await engineWith(provider).enhanceExistingMCQs(preparedText(), {
    explanation: true,
    category: "RESOURCE",
    difficulty: "Hard",
  });

  assert.equal(result.items[0]?.category, "RESOURCE");
  assert.equal(result.items[0]?.difficulty, "Hard");
});

test("enhancement does not run for extracted candidates without an explicit answer", async () => {
  const provider = new QueueProvider([extractionResponse([
    extractedItem({ correctAnswer: null }),
  ])]);
  const result = await engineWith(provider).enhanceExistingMCQs(preparedText(), { explanation: true });

  assert.equal(provider.calls.length, 1);
  assert.equal(result.items[0]?.correctAnswer, null);
  assert.equal(result.items[0]?.provenance, "extracted");
  assert.equal(result.items[0]?.needsReview, true);
  assert.ok(result.warnings.some((warning) => warning.includes("eligible")));
});

test("enhancement flags unknown IDs and preserves candidates without a stage-2 result", async () => {
  const provider = new QueueProvider([
    extractionResponse([extractedItem({ explanation: null })]),
    {
      items: [{
        candidateId: crypto.randomUUID(),
        explanation: "Untrusted unknown candidate",
        confidence: 0.99,
        uncertainties: [],
      }],
      uncertainties: [],
    },
  ]);
  const result = await engineWith(provider).enhanceExistingMCQs(preparedText(), { explanation: true });

  assert.ok(result.warnings.some((warning) => warning.includes("unknown candidate ID")));
  assert.ok(result.items[0]?.warnings.some((warning) => warning.includes("No enhancement result")));
  assert.equal(result.items[0]?.explanation, null);
});

test("enhancement provider schema cannot write immutable MCQ fields", () => {
  const parsed = mcqEnhancementProviderResponseSchema.safeParse({
    items: [{
      candidateId: crypto.randomUUID(),
      question: "attempted rewrite",
      confidence: 0.9,
      uncertainties: [],
    }],
    uncertainties: [],
  });
  assert.equal(parsed.success, false);
});

test("enhancement Stage 2 schema contains only requested writable fields", () => {
  const hintOnly = createMCQEnhancementProviderResponseSchema({ hint: true, explanation: false });
  const candidateId = crypto.randomUUID();
  assert.equal(hintOnly.safeParse({
    items: [{ candidateId, hint: "A hint", confidence: 0.9, uncertainties: [] }],
    uncertainties: [],
  }).success, true);
  assert.equal(hintOnly.safeParse({
    items: [{ candidateId, explanation: "An explanation", confidence: 0.9, uncertainties: [] }],
    uncertainties: [],
  }).success, false);
});

test("provider schemas remain operation-specific and strict", () => {
  assert.equal(mcqExtractionProviderResponseSchema.safeParse({
    items: [],
    skippedItems: [],
    truncated: false,
    uncertainties: [],
  }).success, true);
  assert.equal(mcqGenerationProviderResponseSchema.safeParse({
    items: [generatedItem()],
    uncertainties: [],
  }).success, true);
  assert.equal(mcqGenerationProviderResponseSchema.safeParse({
    items: [{ ...generatedItem(), correctAnswer: null }],
    uncertainties: [],
  }).success, false);
});