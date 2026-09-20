import assert from "node:assert/strict";
import test from "node:test";
import { AIContentService } from "../server/services/ai/AIContentService.js";
import { AIServiceError } from "../server/services/ai/errors.js";
import { parseDeterministicMCQs } from "../server/services/ai/mcq/deterministicExtract.js";
import { parseDeterministicFlashcards } from "../server/services/ai/flashcard/deterministicExtract.js";
import { runResilientBatches } from "../server/services/ai/reliability.js";
import { AIPreviewJobManager } from "../server/services/ai/http/previewJobs.js";

test("deterministic MCQ extraction is lossless for a complete 80-question source", () => {
  const source = Array.from({ length: 80 }, (_, index) => [
    `${index + 1}. Which finding belongs to item ${index + 1}?`,
    "A) First option",
    "B) Second option",
    "C) Third option",
    "D) Fourth option",
    "Answer: A",
  ].join("\n")).join("\n\n");
  const parsed = parseDeterministicMCQs(source);
  assert.ok(parsed);
  assert.equal(parsed.items.length, 80);
  assert.deepEqual(parsed.items.map((item) => item.sourceOrdinal), Array.from({ length: 80 }, (_, index) => index + 1));
  assert.equal(parsed.items[79]?.question, "Which finding belongs to item 80?");
});

test("deterministic MCQ extraction refuses partial or multiple-answer structures", () => {
  assert.equal(parseDeterministicMCQs([
    "1. Incomplete question",
    "A) only one option",
    "2. Another question",
  ].join("\n")), null);
  const parsed = parseDeterministicMCQs([
    "1. Which answers apply?",
    "A) First",
    "B) Second",
    "C) Third",
    "D) Fourth",
    "Answer: A + B",
    "2. Which answer applies?",
    "A) First",
    "B) Second",
    "C) Third",
    "D) Fourth",
    "Answer: C",
  ].join("\n"));
  assert.ok(parsed);
  assert.equal(parsed.items[0]?.correctAnswer, null);
  assert.match(parsed.items[0]?.uncertainties[0] ?? "", /multiple answers/i);
});

test("deterministic Flashcard extraction stays conservative", () => {
  const parsed = parseDeterministicFlashcards([
    "Q: What pumps systemic circulation?",
    "A: The left ventricle.",
    "Q: What carries oxygen?",
    "A: Hemoglobin.",
  ].join("\n"));
  assert.ok(parsed);
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[1]?.clinicalConcept, "What carries oxygen?");
  assert.equal(parseDeterministicFlashcards("A lecture paragraph without card markers."), null);
});

test("failed reliability batches split only the failed range", async () => {
  const attempted: Array<[number, number]> = [];
  const result = await runResilientBatches({
    total: 80,
    batchSize: 25,
    run: async (batch) => {
      attempted.push([batch.start, batch.count]);
      if (batch.start === 25 && batch.count === 25) throw new Error("one shard failed");
      return batch;
    },
  });
  assert.deepEqual(result.map((batch) => [batch.start, batch.count]), [
    [0, 25],
    [25, 13],
    [38, 12],
    [50, 25],
    [75, 5],
  ]);
  assert.ok(attempted.some(([start, count]) => start === 25 && count === 25));
  assert.ok(!attempted.some(([start]) => start === 0 && start !== 0));
});

test("AIContentService retries only bounded transient provider failures", async () => {
  let calls = 0;
  const service = new AIContentService({
    async generateStructured<T>() {
      calls += 1;
      if (calls < 3) throw new AIServiceError("AI_UNAVAILABLE", {
        publicMessage: "temporary",
        retryable: true,
      });
      return { data: { ok: true } as T, meta: { provider: "fake", model: "test" } };
    },
  }, { retryBaseDelayMs: 0 });
  const response = await service.generateStructured({
    contents: [{
      kind: "text",
      text: "source",
      source: { inputType: "text" },
      sizeBytes: 6,
      sha256: "a".repeat(64),
    }],
    responseSchema: (await import("zod")).z.object({ ok: (await import("zod")).z.boolean() }),
  });
  assert.equal(calls, 3);
  assert.equal(response.data.ok, true);
});

test("preview jobs are owner-bound and explicit cancellation is terminal", async () => {
  const manager = new AIPreviewJobManager({ terminalTtlMs: 1_000, hardTimeoutMs: 60_000 });
  let dispatchStarted = false;
  const job = manager.create({
    ownerId: "admin-a",
    target: "mcq",
    operation: "extract",
    inputKind: "text",
    lecture: { id: "lecture-1", name: "Test" },
    requestId: "request-1",
    rawInput: { kind: "text", text: "source" },
    inputService: {
      withPreparedInput: async (_input, operation) => operation({} as never),
    } as never,
    engineFactory: () => ({}) as never,
    options: {},
    dispatch: async (_engines, _parsed, _prepared, signal) => {
      dispatchStarted = true;
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new Error("cancelled");
    },
    buildResponse: () => ({ ok: true }),
  });
  assert.equal(manager.get(job.jobId, "admin-b"), null);
  assert.equal(manager.cancel(job.jobId, "admin-b"), null);
  const cancelled = manager.cancel(job.jobId, "admin-a");
  assert.equal(cancelled?.state, "cancelled");
  assert.equal(dispatchStarted, true);
  assert.equal(manager.get(job.jobId, "admin-a")?.state, "cancelled");
});