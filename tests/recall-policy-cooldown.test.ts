import assert from "node:assert/strict";
import test from "node:test";
import {
  filterRecallCandidatesByCooldown,
} from "../server/features/recall/candidateService.js";
import type { RecallCandidate } from "../server/features/recall/candidateTypes.js";

const candidate = (
  itemType: "MCQ" | "FLASHCARD",
  itemId: string,
): RecallCandidate => ({ itemType, itemId } as RecallCandidate);

test("protected cooldown filters recent presentations without changing type identity", () => {
  const asOf = new Date("2026-09-26T12:00:00.000Z");
  const mcq = candidate("MCQ", "shared-id");
  const flashcard = candidate("FLASHCARD", "shared-id");
  const recent = new Date(asOf.getTime() - 71 * 60 * 60 * 1000);
  const lastPresentedAt = new Map([
    [`MCQ\u0000shared-id`, recent],
  ]);

  assert.deepEqual(
    filterRecallCandidatesByCooldown([mcq, flashcard], lastPresentedAt, asOf),
    [flashcard],
  );
});

test("an item becomes eligible at exactly 72 hours after presentation", () => {
  const asOf = new Date("2026-09-26T12:00:00.000Z");
  const item = candidate("MCQ", "mcq-1");
  const exactlyAtCutoff = new Date(asOf.getTime() - 72 * 60 * 60 * 1000);

  assert.deepEqual(
    filterRecallCandidatesByCooldown(
      [item],
      new Map([["MCQ\u0000mcq-1", exactlyAtCutoff]]),
      asOf,
    ),
    [item],
  );
});