import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { recallIssuanceFingerprint } from "../server/features/recall/fingerprint.js";
import {
  flashcardRecallAnswerBodySchema,
  mcqRecallAnswerBodySchema,
  recallSkipBodySchema,
} from "../server/features/recall/schemas.js";
import { deriveRecallItemState } from "../server/features/recall/stateReducer.js";
import type { RecallAttemptFact } from "../server/features/recall/types.js";

const NOW = new Date("2026-09-26T12:00:00.000Z");

function fact(
  id: string,
  overrides: Partial<RecallAttemptFact> = {},
): RecallAttemptFact {
  return {
    id,
    userId: "user-1",
    itemType: "MCQ",
    itemId: "item-1",
    lectureId: "lecture-1",
    status: "PRESENTED",
    presentedAt: NOW,
    expiresAt: null,
    answeredAt: null,
    skippedAt: null,
    expiredAt: null,
    answerKind: null,
    answerValue: null,
    outcome: null,
    evidenceClass: "SERVER_VALIDATED",
    privacyClass: "PRIVATE_STUDY",
    createdAt: NOW,
    ...overrides,
  };
}

test("Recall state reducer counts objective MCQ outcomes separately from terminal states", () => {
  const state = deriveRecallItemState([
    fact("presented"),
    fact("correct", {
      status: "ANSWERED",
      presentedAt: new Date(NOW.getTime() + 1_000),
      answeredAt: new Date(NOW.getTime() + 2_000),
      answerKind: "MCQ_OPTION",
      answerValue: "A",
      outcome: "CORRECT",
      evidenceClass: "SERVER_DERIVED",
    }),
    fact("incorrect", {
      status: "ANSWERED",
      presentedAt: new Date(NOW.getTime() + 3_000),
      answeredAt: new Date(NOW.getTime() + 4_000),
      answerKind: "MCQ_OPTION",
      answerValue: "B",
      outcome: "INCORRECT",
      evidenceClass: "SERVER_DERIVED",
    }),
    fact("skipped", {
      status: "SKIPPED",
      presentedAt: new Date(NOW.getTime() + 5_000),
      skippedAt: new Date(NOW.getTime() + 6_000),
    }),
    fact("expired", {
      status: "EXPIRED",
      presentedAt: new Date(NOW.getTime() + 7_000),
      expiresAt: new Date(NOW.getTime() + 7_500),
      expiredAt: new Date(NOW.getTime() + 8_000),
    }),
  ]);

  assert.ok(state);
  assert.equal(state.presentationCount, 5);
  assert.equal(state.answerCount, 2);
  assert.equal(state.skipCount, 1);
  assert.equal(state.objectiveCorrectCount, 1);
  assert.equal(state.objectiveIncorrectCount, 1);
  assert.equal(state.lastOutcome, "EXPIRED");
  assert.equal(state.revision, 9);
  assert.equal(state.selfReportedHardCount, 0);
  assert.equal(state.selfReportedMediumCount, 0);
  assert.equal(state.selfReportedEasyCount, 0);
});

test("Recall state reducer preserves the existing three-level Flashcard self-report", () => {
  const ratings = [
    ["hard", "SELF_REPORTED_HARD"],
    ["medium", "SELF_REPORTED_MEDIUM"],
    ["easy", "SELF_REPORTED_EASY"],
  ] as const;
  const state = deriveRecallItemState(
    ratings.map(([rating, outcome], index) =>
      fact(`flashcard-${rating}`, {
        itemType: "FLASHCARD",
        status: "ANSWERED",
        presentedAt: new Date(NOW.getTime() + index * 2_000),
        answeredAt: new Date(NOW.getTime() + index * 2_000 + 1_000),
        answerKind: "FLASHCARD_RECALL_RATING",
        answerValue: rating,
        outcome,
        evidenceClass: "CLIENT_OBSERVED",
      }),
    ),
  );

  assert.ok(state);
  assert.equal(state.presentationCount, 3);
  assert.equal(state.answerCount, 3);
  assert.equal(state.selfReportedHardCount, 1);
  assert.equal(state.selfReportedMediumCount, 1);
  assert.equal(state.selfReportedEasyCount, 1);
  assert.equal(state.objectiveCorrectCount, 0);
  assert.equal(state.objectiveIncorrectCount, 0);
});

test("Recall state reducer rejects client-asserted MCQ correctness evidence", () => {
  assert.throws(
    () =>
      deriveRecallItemState([
        fact("bad-evidence", {
          status: "ANSWERED",
          answeredAt: NOW,
          answerKind: "MCQ_OPTION",
          answerValue: "A",
          outcome: "CORRECT",
          evidenceClass: "CLIENT_OBSERVED",
        }),
      ]),
    { code: "RECALL_STATE_CORRUPT" },
  );
});

test("Recall issuance fingerprint changes with its semantic source context", () => {
  const base = {
    userId: "user-1",
    itemType: "MCQ" as const,
    itemId: "item-1",
    lectureId: "lecture-1",
    issuanceIdempotencyKey: "issue-key-123",
    expiresAt: new Date("2026-09-26T13:00:00.000Z"),
  };
  const fingerprint = recallIssuanceFingerprint(base);
  assert.equal(recallIssuanceFingerprint(base), fingerprint);
  assert.notEqual(
    recallIssuanceFingerprint({ ...base, lectureId: "lecture-2" }),
    fingerprint,
  );
  assert.notEqual(
    recallIssuanceFingerprint({ ...base, itemId: "item-2" }),
    fingerprint,
  );
  assert.notEqual(
    recallIssuanceFingerprint({
      ...base,
      expiresAt: new Date("2026-09-26T14:00:00.000Z"),
    }),
    fingerprint,
  );
});

test("Recall request schemas accept bounded values and reject client outcome claims", () => {
  assert.deepEqual(mcqRecallAnswerBodySchema.parse({ selectedOption: "A" }), {
    selectedOption: "A",
  });
  assert.equal(
    mcqRecallAnswerBodySchema.safeParse({
      selectedOption: "A",
      correct: true,
    }).success,
    false,
  );
  assert.deepEqual(flashcardRecallAnswerBodySchema.parse({ rating: "hard" }), {
    rating: "hard",
  });
  assert.equal(
    flashcardRecallAnswerBodySchema.safeParse({ rating: "remembered" }).success,
    false,
  );
  assert.equal(
    flashcardRecallAnswerBodySchema.safeParse({
      rating: "easy",
      outcome: "CORRECT",
    }).success,
    false,
  );
  assert.equal(recallSkipBodySchema.safeParse({}).success, true);
  assert.equal(recallSkipBodySchema.safeParse({ incorrect: true }).success, false);
});

test("Prompt 28 migration is additive and creates only the two Recall tables", () => {
  const migration = readFileSync(
    fileURLToPath(
      new URL(
        "../prisma/migrations/20260926140000_spaced_recall_attempt_state/migration.sql",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  assert.equal((migration.match(/CREATE TABLE/gu) ?? []).length, 2);
  assert.match(migration, /CREATE TABLE "RecallAttempt"/u);
  assert.match(migration, /CREATE TABLE "RecallItemState"/u);
  assert.match(migration, /FOREIGN KEY \("userId"\) REFERENCES "User"\("id"\)/u);
  assert.doesNotMatch(
    migration,
    /^\s*(?:DROP|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|ALTER\s+TABLE)\b/gimu,
  );
});