import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare-content-api/src/index";

const contentWorker = (worker as any).default ?? (worker as any);

test("D1 MCQ sync persists canonical category and internal difficulty", async () => {
  const values: unknown[][] = [];
  const env = {
    CONTENT_SYNC_SECRET: "test-secret",
    DB: {
      prepare() {
        return {
          bind(...bound: unknown[]) {
            values.push(bound);
            return { async run() {} };
          },
        };
      },
    },
  };
  const response = await contentWorker.fetch(new Request("https://worker.test/internal/content-sync", {
    method: "POST",
    headers: { "X-Content-Sync-Secret": "test-secret", "Content-Type": "application/json" },
    body: JSON.stringify({
      version: 1,
      entity: "Mcq",
      operation: "upsert",
      id: "mcq-1",
      data: {
        id: "mcq-1",
        question: "Question",
        optionA: "A",
        optionB: "B",
        optionC: "C",
        optionD: "D",
        correctAnswer: "A",
        hint: null,
        explanation: null,
        sourceType: "AI_GENERATED",
        sourceRef: "",
        difficulty: "Medium",
        lectureId: "lecture-1",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    }),
  }), env);
  assert.equal(response.status, 200);
  assert.equal(values[0]?.[0], "mcq-1");
  assert.equal(values[0]?.[9], "AI_GENERATED");
  assert.equal(values[0]?.[11], "Medium");
});

test("D1 MCQ sync rejects virtual All category", async () => {
  const env = {
    CONTENT_SYNC_SECRET: "test-secret",
    DB: { prepare() { return { bind() { return { async run() {} }; } }; } },
  };
  const response = await contentWorker.fetch(new Request("https://worker.test/internal/content-sync", {
    method: "POST",
    headers: { "X-Content-Sync-Secret": "test-secret", "Content-Type": "application/json" },
    body: JSON.stringify({
      version: 1, entity: "Mcq", operation: "upsert", id: "mcq-1",
      data: { id: "mcq-1", correctAnswer: "A", sourceType: "ALL", difficulty: "Medium" },
    }),
  }), env);
  assert.equal(response.status, 400);
});