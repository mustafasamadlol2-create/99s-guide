import assert from "node:assert/strict";
import test from "node:test";
import { pollAIPreviewJob } from "../src/features/lectures/ai/api/aiPreviewApi";
import type { AIProvider, StructuredGenerationRequest, StructuredGenerationResult } from "../server/services/ai/contracts.js";
import { AIContentService } from "../server/services/ai/AIContentService.js";
import type { PreparedAIInput } from "../server/services/ai/input/contracts.js";
import { MCQAIEngine } from "../server/services/ai/mcq/index.js";
import { FlashcardAIEngine } from "../server/services/ai/flashcard/index.js";
import { mcqGenerationProviderResponseSchema, createMCQEnhancementProviderResponseSchema } from "../server/services/ai/mcq/schemas.js";
import { flashcardGenerationProviderResponseSchema } from "../server/services/ai/flashcard/schemas.js";

type AnyResponse = Record<string, unknown>;
class FakeProvider implements AIProvider {
  calls: StructuredGenerationRequest<unknown>[] = [];
  constructor(private readonly fn: (request: StructuredGenerationRequest<unknown>, call: number) => AnyResponse | Promise<AnyResponse>) {}
  async generateStructured<T>(request: StructuredGenerationRequest<T>): Promise<StructuredGenerationResult<T>> {
    this.calls.push(request as StructuredGenerationRequest<unknown>);
    const value = await this.fn(request as StructuredGenerationRequest<unknown>, this.calls.length);
    return { data: request.responseSchema.parse(value), meta: { provider: "mock", model: "deterministic" } };
  }
}
function prepared(text: string): PreparedAIInput {
  const source = { inputType: "text" as const, section: "test" };
  return { input: { kind: "text", text: { kind: "text", origin: "pasted_text", text, mimeType: "text/plain", sizeBytes: text.length, sha256: "a".repeat(64), source } }, contents: [{ kind: "text", text, source, sizeBytes: text.length, sha256: "a".repeat(64) }], dispose: async () => {} };
}
const meta = { provider: "mock", model: "deterministic" };
const mcqItem = (n: number, ordinal?: number) => ({ ...(ordinal === undefined ? {} : { sourceOrdinal: ordinal }), question: `Question ${n}`, options: ["A", "B", "C", "D"], correctAnswer: "A", hint: null, explanation: null, difficulty: null, source: null, uncertainties: [] });
const cardItem = (n: number) => ({ clinicalConcept: `Concept ${n}`, explanation: `Explanation ${n}`, source: null, uncertainties: [] });

test("preview polling has no overall deadline and uses an injected virtual clock", async () => {
  let reads = 0; let waits = 0;
  const answer = { operation: "extract", target: "mcq", items: [] } as never;
  const result = await pollAIPreviewJob(new AbortController().signal, {
    readStatus: async () => {
      reads += 1;
      return reads > 121 ? { jobId: "j", state: "succeeded", target: "mcq", operation: "extract", inputKind: "text", progress: { stage: "done", completedBatches: 1, itemsRecovered: 0 }, response: answer } : { jobId: "j", state: "running", target: "mcq", operation: "extract", inputKind: "text", progress: { stage: "running", completedBatches: 0, itemsRecovered: 0 } };
    },
    wait: async () => { waits += 1; },
  });
  assert.equal(result, answer); assert.equal(reads, 122); assert.equal(waits, 121);
});

test("preview polling retries network, 408, 502, and 503 failures", async () => {
  const failures = [new Error("network down"), Object.assign(new Error("timeout"), { status: 408 }), Object.assign(new Error("bad gateway"), { status: 502 }), Object.assign(new Error("unavailable"), { status: 503 })];
  let reads = 0; let waits = 0;
  const answer = { operation: "extract", target: "mcq", items: [] } as never;
  const result = await pollAIPreviewJob(new AbortController().signal, {
    readStatus: async () => { if (reads < failures.length) throw failures[reads++]; reads += 1; return { jobId: "j", state: "succeeded", target: "mcq", operation: "extract", inputKind: "text", progress: { stage: "done", completedBatches: 1, itemsRecovered: 0 }, response: answer }; },
    wait: async () => { waits += 1; },
  });
  assert.equal(result, answer); assert.equal(waits, 4);
});

test("MCQ numbered fallback preserves source order, splits only failed range, and selectively recovers omissions", async () => {
  const source = Array.from({ length: 100 }, (_, i) => `${i + 1}. source item ${i + 1}`).join("\n");
  const provider = new FakeProvider((request, call) => {
    const text = request.contents[0]!.kind === "text" ? request.contents[0]!.text : "";
    const ordinals = [...text.matchAll(/^(\d+)\./gmu)].map((m) => Number(m[1]));
    if (ordinals[0] === 26 && ordinals.length === 25 && call === 2) throw new Error("range failure");
    const omit = call === 3 ? new Set([32, 33]) : call === 5 ? new Set([57]) : new Set<number>();
    return { items: ordinals.filter((n) => !omit.has(n)).map((n) => mcqItem(n, n)), skippedItems: [], truncated: false, uncertainties: [] };
  });
  const result = await new MCQAIEngine(new AIContentService(provider, { retryBaseDelayMs: 0 }), undefined, () => "00000000-0000-4000-8000-000000000001").extractExistingMCQs(prepared(source));
  assert.equal(result.items.length, 100);
  assert.deepEqual(result.items.map((item) => item.sourceOrdinal), Array.from({ length: 100 }, (_, i) => i + 1));
  assert.ok(provider.calls.every((call) => (call.maxItems ?? 0) <= 25));
  assert.ok(provider.calls.some((call) => String(call.trustedSystemInstruction).includes("32, 33")));
});

test("MCQ zero-result numbered recovery throws AI_EXTRACTION_INCOMPLETE", async () => {
  const source = "1. first\n2. second\n3. third";
  const provider = new FakeProvider(() => ({ items: [], skippedItems: [], truncated: false, uncertainties: [] }));
  await assert.rejects(() => new MCQAIEngine(new AIContentService(provider, { retryBaseDelayMs: 0 })).extractExistingMCQs(prepared(source)), (error: any) => error.code === "AI_EXTRACTION_INCOMPLETE");
  assert.ok(provider.calls.length <= 7);
});

test("Flashcard extraction shards large text and recovers a failed shard", async () => {
  const source = Array.from({ length: 120 }, (_, index) =>
    `Lecture section ${index + 1}: ${"source-grounded medical detail ".repeat(28)}`,
  ).join("\n");
  let failed = false;
  const provider = new FakeProvider((request, call) => {
    if (request.operation !== "extract") return { items: [], uncertainties: [] };
    if (call === 2 && !failed) {
      failed = true;
      throw new Error("temporary shard failure");
    }
    return {
      items: [{
        clinicalConcept: `Recovered card ${call}`,
        explanation: `Grounded explanation ${call}`,
        source: null,
        uncertainties: [],
      }],
      skippedItems: [],
      truncated: false,
      uncertainties: [],
    };
  });
  const result = await new FlashcardAIEngine(
    new AIContentService(provider, { retryBaseDelayMs: 0 }),
  ).extractExistingFlashcards(prepared(source));
  assert.ok(provider.calls.length > 2);
  assert.ok(result.items.length >= 3);
  assert.ok(result.items.every((item) => item.clinicalConcept && item.explanation));
});

test("MCQ generation 80 uses bounded calls, distinct coverage, and warns when source is insufficient", async () => {
  const provider = new FakeProvider((request) => ({ items: Array.from({ length: Number(request.requestedCount) }, (_, i) => ({ question: `Q${i}-${request.contents[0]?.kind}`, optionA: "A", optionB: "B", optionC: "C", optionD: "D", correctAnswer: "A", hint: null, explanation: null, difficulty: null, source: null, uncertainties: [] })), uncertainties: [] }));
  const result = await new MCQAIEngine(new AIContentService(provider, { retryBaseDelayMs: 0 }), undefined, () => crypto.randomUUID()).generateMCQs(prepared("long source"), { count: 80, questionStyle: "direct", includeHints: false, includeExplanations: false });
  assert.equal(result.items.length, 80); assert.equal(provider.calls.length, 4); assert.ok(provider.calls.every((c) => c.requestedCount !== 80 && (c.maxItems ?? 0) <= 20));
  assert.equal(new Set(provider.calls.map((c) => c.trustedSystemInstruction.match(/window \d+/)?.[0])).size, 4);
  const sparse = new FakeProvider(() => ({ items: [{ question: "Only one", optionA: "A", optionB: "B", optionC: "C", optionD: "D", correctAnswer: "A", hint: null, explanation: null, difficulty: null, source: null, uncertainties: [] }], uncertainties: [] }));
  const fewer = await new MCQAIEngine(new AIContentService(sparse, { retryBaseDelayMs: 0 })).generateMCQs(prepared("short"), { count: 3, questionStyle: "direct", includeHints: false, includeExplanations: false });
  assert.ok(fewer.items.length < 3); assert.ok(fewer.warnings.some((w) => /only/i.test(w)));
});

test("MCQ enhancement preserves structure, recovers missing IDs, and flags answer contradiction", async () => {
  const ids = Array.from({ length: 80 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
  let generatedId = 0;
  const source = Array.from({ length: 80 }, (_, i) => `${i + 1}. source ${i + 1}`).join("\n");
  let phase = "extract";
  const provider = new FakeProvider((request) => {
    if (phase === "extract") { phase = "enhance"; return { items: ids.map((_, i) => mcqItem(i + 1, i + 1)), skippedItems: [], truncated: false, uncertainties: [] }; }
    const context = String(request.additionalUntrustedContext); const selected = ids.filter((id) => context.includes(id));
    return { items: selected.slice(0, selected.length === 80 ? 78 : selected.length).map((candidateId) => ({ candidateId, hint: "Hint", explanation: candidateId === ids[0] ? "The correct answer is B." : "Explanation", uncertainties: [] })), uncertainties: [] };
  });
  const result = await new MCQAIEngine(new AIContentService(provider, { retryBaseDelayMs: 0 }), undefined, () => ids[generatedId++]!).enhanceExistingMCQs(prepared(source), { hint: true, explanation: true });
  assert.equal(result.items.length, 80); assert.ok(result.items.every((x) => x.optionA && x.optionD && x.correctAnswer === "A")); assert.ok(result.items.some((x) => x.warnings.some((w) => /preserved/i.test(w))));
});

test("Flashcard large generation and enhancement preserve count and recover missing IDs", async () => {
  const provider = new FakeProvider((request) => {
    if (request.operation === "generate") return { items: Array.from({ length: Number(request.requestedCount) }, (_, i) => cardItem(i)), uncertainties: [] };
    if (request.operation === "extract") return { items: Array.from({ length: 80 }, (_, i) => ({ clinicalConcept: `Concept ${i}`, explanation: null, source: null, uncertainties: [] })), skippedItems: [], truncated: false, uncertainties: [] };
    const ids = [...String(request.additionalUntrustedContext).matchAll(/candidateId":"([^"]+)/g)].map((m) => m[1]!);
    return { items: (ids.length <= 2 ? ids : ids.slice(0, Math.max(0, ids.length - 2))).map((candidateId) => ({ candidateId, explanation: "Recovered", confidence: 0.9, uncertainties: [], source: null })), uncertainties: [] };
  });
  const engine = new FlashcardAIEngine(new AIContentService(provider, { retryBaseDelayMs: 0 }), undefined, (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; })());
  const generated = await engine.generateFlashcards(prepared("source"), { count: 80 }); assert.equal(generated.items.length, 80); assert.equal(provider.calls.filter((c) => c.operation === "generate").length, 4);
  const largeFlashcardSource = Array.from({ length: 80 }, (_, i) => `Q: Source concept ${i + 1}\nA: Source answer ${i + 1}`).join("\n");
  const enhanced = await engine.enhanceExistingFlashcards(prepared(largeFlashcardSource), {});
  assert.equal(enhanced.items.length, 80);
  assert.ok(enhanced.items.every((x) => x.clinicalConcept));
  assert.ok(enhanced.items.every((x) => x.explanation));
});

test("provider schemas accept omitted optional confidence", () => {
  const mcq = mcqGenerationProviderResponseSchema.parse({ items: [{ question: "Q", optionA: "A", optionB: "B", optionC: "C", optionD: "D", correctAnswer: "A", hint: null, explanation: null, difficulty: null, source: null, uncertainties: [] }], uncertainties: [] });
  const card = flashcardGenerationProviderResponseSchema.parse({ items: [{ clinicalConcept: "Front", explanation: "Back", source: null, uncertainties: [] }], uncertainties: [] });
  const enhancement = createMCQEnhancementProviderResponseSchema({ hint: true, explanation: true }).parse({ items: [{ candidateId: "00000000-0000-4000-8000-000000000001", hint: "h", explanation: "e", uncertainties: [] }], uncertainties: [] });
  assert.equal(mcq.items[0]!.confidence, 0.5); assert.equal(card.items[0]!.confidence, 0.5); assert.equal(enhancement.items[0]!.confidence, 0.5);
});