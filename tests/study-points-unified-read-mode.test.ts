import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveUnifiedStudyPointsReadMode } from "../server/features/study-points/readModel.js";

test("active gamification reads never use the legacy balance alone", () => {
  assert.equal(
    resolveUnifiedStudyPointsReadMode("LEGACY_ONLY"),
    "LEGACY_PLUS_LEDGER",
  );
  assert.equal(
    resolveUnifiedStudyPointsReadMode("LEGACY_PLUS_LEDGER"),
    "LEGACY_PLUS_LEDGER",
  );
  assert.equal(
    resolveUnifiedStudyPointsReadMode("LEDGER_ONLY"),
    "LEDGER_ONLY",
  );
  assert.equal(resolveUnifiedStudyPointsReadMode(undefined), "LEGACY_PLUS_LEDGER");
});
