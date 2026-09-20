import assert from "node:assert/strict";
import test from "node:test";
import { errorMessageFromBody } from "../src/core/api/apiClient";

test("API client displays nested server error messages without object coercion", () => {
  assert.equal(
    errorMessageFromBody({ error: { code: "AI_TIMEOUT", message: "The AI request timed out." } }),
    "The AI request timed out.",
  );
  assert.notEqual(
    errorMessageFromBody({ error: { message: "The AI request timed out." } }),
    "[object Object]",
  );
});

test("API client preserves legacy string and top-level message errors", () => {
  assert.equal(errorMessageFromBody({ error: "Invalid file." }), "Invalid file.");
  assert.equal(errorMessageFromBody({ message: "Authentication required." }), "Authentication required.");
  assert.equal(errorMessageFromBody({ error: { code: "UNKNOWN" } }), undefined);
});