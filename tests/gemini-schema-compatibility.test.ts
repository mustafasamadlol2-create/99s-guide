import assert from "node:assert/strict";
import test from "node:test";
import { toJSONSchema } from "zod";
import {
  sanitizeGeminiJsonSchema,
} from "../server/services/ai/GeminiProvider.js";
import {
  mcqExtractionProviderResponseSchema,
  mcqGenerationProviderResponseSchema,
  mcqEnhancementProviderResponseSchema,
} from "../server/services/ai/mcq/schemas.js";
import {
  flashcardExtractionProviderResponseSchema,
  flashcardGenerationProviderResponseSchema,
  flashcardEnhancementProviderResponseSchema,
} from "../server/services/ai/flashcard/schemas.js";

const unsupportedProviderKeywords = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "pattern",
  "const",
  "uniqueItems",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "allOf",
  "not",
  "if",
  "then",
  "else",
  "examples",
  "default",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
]);

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((child) => collectKeys(child, keys));
    return keys;
  }
  if (typeof value !== "object" || value === null) return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectKeys(child, keys);
  }
  return keys;
}

function projectedSchema(schema: unknown): any {
  return sanitizeGeminiJsonSchema(toJSONSchema(schema as never, { target: "draft-07" }));
}

test("projects all six operation schemas to the Gemini compatibility subset", () => {
  const schemas = [
    mcqExtractionProviderResponseSchema,
    mcqGenerationProviderResponseSchema,
    mcqEnhancementProviderResponseSchema,
    flashcardExtractionProviderResponseSchema,
    flashcardGenerationProviderResponseSchema,
    flashcardEnhancementProviderResponseSchema,
  ];

  for (const schema of schemas) {
    const projected = projectedSchema(schema);
    const keys = collectKeys(projected);
    for (const key of unsupportedProviderKeywords) {
      assert.equal(keys.has(key), false, `unsupported provider keyword: ${key}`);
    }
    assert.equal(projected.type, "object");
    assert.ok(projected.required.includes("items"));
    assert.ok(projected.required.includes("uncertainties"));
    assert.ok(projected.properties.items);
    assert.equal(projected.properties.items.type, "array");
    assert.ok(projected.properties.items.items);
  }
});

test("preserves required fields, enums, nested objects, and nullable unions", () => {
  const projected = projectedSchema(mcqGenerationProviderResponseSchema);
  const item = projected.properties.items.items;

  assert.deepEqual(item.required, [
    "question",
    "optionA",
    "optionB",
    "optionC",
    "optionD",
    "correctAnswer",
    "hint",
    "explanation",
    "difficulty",
    "confidence",
    "uncertainties",
  ]);
  assert.deepEqual(item.properties.correctAnswer.enum, ["A", "B", "C", "D"]);
  assert.deepEqual(item.properties.hint.anyOf, [
    { type: "string" },
    { type: "null" },
  ]);
  assert.equal(item.properties.source.anyOf[0].type, "object");
  assert.ok(item.properties.source.anyOf[0].properties.inputType.enum);
});

test("strict Zod validation remains the post-provider trust boundary", () => {
  const projected = projectedSchema(mcqGenerationProviderResponseSchema);
  const item = projected.properties.items.items;
  assert.equal(item.properties.question.type, "string");
  assert.equal(item.properties.confidence.type, "number");
  assert.equal(item.properties.uncertainties.type, "array");

  assert.throws(() => mcqGenerationProviderResponseSchema.parse({
    items: [{
      question: "",
      optionA: "A",
      optionB: "B",
      optionC: "C",
      optionD: "D",
      correctAnswer: "X",
      hint: null,
      explanation: null,
      difficulty: null,
      source: null,
      confidence: 2,
      uncertainties: [],
    }],
    uncertainties: [],
  }));
});