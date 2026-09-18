import test from "node:test";
import assert from "node:assert/strict";
import {
  MCQ_CATEGORIES,
  MCQ_CATEGORY_FILTERS,
  normalizeMCQCategory,
  normalizeMCQDifficulty,
  parseMCQCategory,
  parseMCQDifficulty,
} from "../shared/mcqMetadata.js";

test("MCQ metadata uses canonical categories and virtual All filter", () => {
  assert.deepEqual(MCQ_CATEGORIES, ["PREVIOUS_YEAR", "AI_GENERATED", "RESOURCE"]);
  assert.deepEqual(MCQ_CATEGORY_FILTERS, ["ALL", "PREVIOUS_YEAR", "AI_GENERATED", "RESOURCE"]);
  assert.equal(parseMCQCategory("ALL"), null);
  assert.equal(parseMCQCategory("book"), "RESOURCE");
  assert.equal(parseMCQCategory("not-a-category"), null);
  assert.equal(normalizeMCQCategory("legacy-value"), "AI_GENERATED");
});

test("MCQ difficulty preserves internal Medium while accepting Normal display compatibility", () => {
  assert.equal(parseMCQDifficulty("Normal"), "Medium");
  assert.equal(parseMCQDifficulty("Medium"), "Medium");
  assert.equal(parseMCQDifficulty("unknown"), null);
  assert.equal(normalizeMCQDifficulty(null), "Medium");
});