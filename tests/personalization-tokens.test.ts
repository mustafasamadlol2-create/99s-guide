import assert from "node:assert/strict";
import test from "node:test";
import {
  CLASSIC_99_FIXED_SEMANTIC_TOKENS,
  CLASSIC_99_SEMANTIC_TOKENS,
  getClassic99SemanticTokens,
} from "../src/features/personalization/classic99Tokens.js";

test("Classic 99 exposes explicit light and dark semantic baselines", () => {
  assert.equal(getClassic99SemanticTokens("light"), CLASSIC_99_SEMANTIC_TOKENS.light);
  assert.equal(getClassic99SemanticTokens("dark"), CLASSIC_99_SEMANTIC_TOKENS.dark);
  assert.equal(CLASSIC_99_SEMANTIC_TOKENS.light.actionAccent, "#007aff");
  assert.equal(CLASSIC_99_SEMANTIC_TOKENS.dark.surfacePrimary, "#000000");
});

test("fixed status and domain colors are not appearance tokens", () => {
  assert.equal(CLASSIC_99_FIXED_SEMANTIC_TOKENS.statusError, "#ff3b30");
  assert.equal(CLASSIC_99_FIXED_SEMANTIC_TOKENS.statusSuccess, "#34c759");
  assert.equal(CLASSIC_99_FIXED_SEMANTIC_TOKENS.statusWarning, "#ff9500");
  assert.equal(CLASSIC_99_FIXED_SEMANTIC_TOKENS.actionDestructive, "#ff3b30");
  assert.equal(CLASSIC_99_FIXED_SEMANTIC_TOKENS.validationError, "#ff3b30");
  assert.equal(CLASSIC_99_FIXED_SEMANTIC_TOKENS.domainAcademicGold, "#d4af37");
});