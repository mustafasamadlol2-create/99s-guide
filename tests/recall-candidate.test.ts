import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateForgettingUrgencyScore,
  calculateRecencyPreferenceScore,
  calculateRecallCandidateScore,
  calculateRecallWeaknessScore,
  compareRecallCandidates,
  findLastPositiveMemoryEvidenceAt,
  rankRecallCandidates,
  scoreRecallCandidate,
} from "../server/features/recall/candidateScoring.js";
import { RECALL_CANDIDATE_LIMITS } from "../server/features/recall/candidateWeights.js";
import {
  normalizeRecallMemoryOutcome,
  normalizeStudyEventMemoryOutcome,
} from "../server/features/recall/sourceEvidence.js";
import type {
  RecallCandidate,
  RecallMemoryEvidence,
  RecallStudiedLectureEvidence,
} from "../server/features/recall/candidateTypes.js";

const AS_OF = new Date("2026-09-26T12:00:00.000Z");

function memory(
  id: string,
  itemType: "MCQ" | "FLASHCARD",
  outcome: RecallMemoryEvidence["outcome"],
  occurredAt: Date,
  itemId = "item-1",
): RecallMemoryEvidence {
  return {
    itemType,
    itemId,
    occurredAt,
    outcome,
    evidenceClass: itemType === "MCQ" ? "SERVER_DERIVED" : "CLIENT_OBSERVED",
    source: "PROMPT28_RECALL",
    sourceId: id,
  };
}

function lecture(lastStudiedAt = new Date(AS_OF.getTime() - 35 * 60_000)): RecallStudiedLectureEvidence {
  return {
    lectureId: "lecture-1",
    firstStudiedAt: lastStudiedAt,
    lastStudiedAt,
    evidenceSources: ["MCQ"],
  };
}

function candidate(
  itemType: "MCQ" | "FLASHCARD",
  itemId: string,
  overrides: Partial<RecallCandidate> = {},
): RecallCandidate {
  return {
    itemType,
    itemId,
    lectureId: "lecture-1",
    weaknessScore: 0,
    forgettingUrgencyScore: 10,
    recencyPreferenceScore: 100,
    candidateScore: 5_000,
    candidateVersion: "recall-candidate-v1",
    ...overrides,
  };
}

test("weakness counts recent meaningful outcomes and caps repeated misses", () => {
  const threeMisses = [
    memory("miss-1", "MCQ", "OBJECTIVE_INCORRECT", new Date(AS_OF.getTime() - 3_000)),
    memory("miss-2", "MCQ", "OBJECTIVE_INCORRECT", new Date(AS_OF.getTime() - 2_000)),
    memory("miss-3", "MCQ", "OBJECTIVE_INCORRECT", new Date(AS_OF.getTime() - 1_000)),
    memory("miss-4", "MCQ", "OBJECTIVE_INCORRECT", AS_OF),
  ];
  assert.equal(calculateRecallWeaknessScore(threeMisses, AS_OF), 75);

  const missThenSuccess = [
    memory("miss", "MCQ", "OBJECTIVE_INCORRECT", new Date(AS_OF.getTime() - 2_000)),
    memory("success", "MCQ", "OBJECTIVE_CORRECT", AS_OF),
  ];
  assert.equal(calculateRecallWeaknessScore(missThenSuccess, AS_OF), 10);
});

test("weakness uses only the newest ten outcomes and applies them chronologically", () => {
  const history = [
    ...Array.from({ length: 10 }, (_, index) =>
      memory(
        `old-miss-${index}`,
        "MCQ",
        "OBJECTIVE_INCORRECT",
        new Date(AS_OF.getTime() - (20_000 - index)),
      ),
    ),
    ...Array.from({ length: 10 }, (_, index) =>
      memory(
        `recent-success-${index}`,
        "MCQ",
        "OBJECTIVE_CORRECT",
        new Date(AS_OF.getTime() - (10_000 - index)),
      ),
    ),
  ];
  assert.equal(calculateRecallWeaknessScore(history, AS_OF), 0);

  const latestMissWins = [
    memory("old-success", "MCQ", "OBJECTIVE_CORRECT", new Date(AS_OF.getTime() - 2_000)),
    memory("new-miss", "MCQ", "OBJECTIVE_INCORRECT", AS_OF),
  ];
  assert.equal(calculateRecallWeaknessScore(latestMissWins, AS_OF), 25);
});

test("Flashcard self-report stays distinct from objective MCQ correctness", () => {
  assert.equal(
    normalizeRecallMemoryOutcome("FLASHCARD", "SELF_REPORTED_HARD"),
    "SELF_REPORTED_NOT_REMEMBERED",
  );
  assert.equal(
    normalizeRecallMemoryOutcome("FLASHCARD", "SELF_REPORTED_MEDIUM"),
    "SELF_REPORTED_NEUTRAL",
  );
  assert.equal(
    normalizeRecallMemoryOutcome("FLASHCARD", "SELF_REPORTED_EASY"),
    "SELF_REPORTED_REMEMBERED",
  );
  assert.equal(
    normalizeStudyEventMemoryOutcome("FLASHCARD", "AGAIN"),
    "SELF_REPORTED_NOT_REMEMBERED",
  );
  assert.equal(
    normalizeStudyEventMemoryOutcome("FLASHCARD", "HARD"),
    "SELF_REPORTED_REMEMBERED",
  );
  assert.equal(
    normalizeRecallMemoryOutcome("MCQ", "SKIPPED"),
    null,
    "Skip/expiry do not become weakness evidence.",
  );
  assert.equal(
    normalizeRecallMemoryOutcome("MCQ", "CORRECT"),
    "OBJECTIVE_CORRECT",
  );
});

test("weakness is zero for unseen items and medium Flashcard ratings are neutral", () => {
  assert.equal(calculateRecallWeaknessScore([], AS_OF), 0);
  assert.equal(
    calculateRecallWeaknessScore(
      [
        memory(
          "medium",
          "FLASHCARD",
          "SELF_REPORTED_NEUTRAL",
          AS_OF,
        ),
      ],
      AS_OF,
    ),
    0,
  );
});

test("forgetting urgency uses the required deterministic day buckets", () => {
  const scoreAtDays = (days: number) =>
    calculateForgettingUrgencyScore(
      AS_OF,
      new Date(AS_OF.getTime() - days * 24 * 60 * 60 * 1_000),
    );

  assert.equal(scoreAtDays(0.5), 10);
  assert.equal(scoreAtDays(1), 25);
  assert.equal(scoreAtDays(3), 45);
  assert.equal(scoreAtDays(7), 65);
  assert.equal(scoreAtDays(14), 80);
  assert.equal(scoreAtDays(30), 100);
  assert.equal(calculateForgettingUrgencyScore(AS_OF, null), 100);
});

test("recency preference is soft, with never-presented items at the top bucket", () => {
  const scoreAtHours = (hours: number) =>
    calculateRecencyPreferenceScore(
      AS_OF,
      new Date(AS_OF.getTime() - hours * 60 * 60 * 1_000),
    );

  assert.equal(scoreAtHours(0.5), 0);
  assert.equal(scoreAtHours(1), 15);
  assert.equal(scoreAtHours(6), 35);
  assert.equal(scoreAtHours(24), 60);
  assert.equal(scoreAtHours(72), 80);
  assert.equal(scoreAtHours(168), 100);
  assert.equal(calculateRecencyPreferenceScore(AS_OF, null), 100);
});

test("unseen items use lecture study age without being labeled weak", () => {
  const scored = scoreRecallCandidate({
    item: { itemType: "MCQ", itemId: "unseen", lectureId: "lecture-1" },
    lecture: lecture(new Date(AS_OF.getTime() - 5 * 24 * 60 * 60 * 1_000)),
    history: [],
    asOf: AS_OF,
  });
  assert.equal(scored.weaknessScore, 0);
  assert.equal(scored.forgettingUrgencyScore, 45);
  assert.equal(scored.recencyPreferenceScore, 100);
});

test("a repeatedly weak item can narrowly outrank an unseen item", () => {
  const weakItem = scoreRecallCandidate({
    item: { itemType: "MCQ", itemId: "weak", lectureId: "lecture-1" },
    lecture: lecture(),
    history: [
      memory(
        "miss-1",
        "MCQ",
        "OBJECTIVE_INCORRECT",
        new Date(AS_OF.getTime() - 2_000),
        "weak",
      ),
    ],
    asOf: AS_OF,
  });
  const unseenItem = scoreRecallCandidate({
    item: { itemType: "MCQ", itemId: "unseen", lectureId: "lecture-1" },
    lecture: lecture(new Date(AS_OF.getTime() - 5 * 24 * 60 * 60 * 1_000)),
    history: [],
    asOf: AS_OF,
  });
  assert.ok(weakItem.candidateScore > unseenItem.candidateScore);
});

test("recent presentation remains eligible and only lowers soft recency preference", () => {
  const recent = scoreRecallCandidate({
    item: { itemType: "MCQ", itemId: "recent", lectureId: "lecture-1" },
    lecture: lecture(),
    state: {
      itemType: "MCQ",
      itemId: "recent",
      lastPresentedAt: new Date(AS_OF.getTime() - 30 * 60_000),
      lastAnsweredAt: null,
      lastOutcome: null,
    },
    history: [],
    asOf: AS_OF,
  });
  assert.equal(recent.recencyPreferenceScore, 0);
  assert.equal(recent.itemId, "recent");
});

test("candidate score uses integer 50/35/15 weights", () => {
  assert.equal(calculateRecallCandidateScore(80, 60, 40), 6_700);
});

test("same inputs and asOf produce an identical candidate ordering", () => {
  const inputs = [
    {
      item: { itemType: "MCQ" as const, itemId: "a", lectureId: "lecture-1" },
      lecture: lecture(),
      history: [
        memory("miss", "MCQ", "OBJECTIVE_INCORRECT", AS_OF, "a"),
      ],
      asOf: AS_OF,
    },
    {
      item: {
        itemType: "FLASHCARD" as const,
        itemId: "b",
        lectureId: "lecture-1",
      },
      lecture: lecture(),
      history: [],
      asOf: AS_OF,
    },
  ];
  assert.deepEqual(rankRecallCandidates(inputs), rankRecallCandidates(inputs));
  assert.deepEqual(
    {
      perLectureMcq: RECALL_CANDIDATE_LIMITS.maxMcqsPerLecture,
      perLectureFlashcard: RECALL_CANDIDATE_LIMITS.maxFlashcardsPerLecture,
      global: RECALL_CANDIDATE_LIMITS.maxRawCandidates,
    },
    { perLectureMcq: 50, perLectureFlashcard: 50, global: 500 },
  );
});

test("last positive memory timestamp uses only the correct positive evidence", () => {
  const successAt = new Date(AS_OF.getTime() - 2 * 24 * 60 * 60 * 1_000);
  const positive = memory("success", "MCQ", "OBJECTIVE_CORRECT", successAt);
  const miss = memory("miss", "MCQ", "OBJECTIVE_INCORRECT", AS_OF);
  assert.equal(
    findLastPositiveMemoryEvidenceAt("MCQ", [positive, miss], undefined, AS_OF),
    successAt,
  );

  const flashcardSuccess = memory(
    "easy",
    "FLASHCARD",
    "SELF_REPORTED_REMEMBERED",
    successAt,
  );
  assert.equal(
    findLastPositiveMemoryEvidenceAt(
      "FLASHCARD",
      [flashcardSuccess],
      undefined,
      AS_OF,
    ),
    successAt,
  );
});

test("candidate tie-breaking is stable and puts MCQ before Flashcard", () => {
  const identicalMcq = candidate("MCQ", "a");
  const identicalFlashcard = candidate("FLASHCARD", "b");
  assert.ok(compareRecallCandidates(identicalMcq, identicalFlashcard) < 0);

  const olderPresentation = candidate("FLASHCARD", "z", {
    lastPresentedAt: new Date(AS_OF.getTime() - 10_000),
  });
  const newerPresentation = candidate("MCQ", "a", {
    lastPresentedAt: new Date(AS_OF.getTime() - 1_000),
  });
  assert.ok(compareRecallCandidates(olderPresentation, newerPresentation) < 0);

  assert.ok(
    compareRecallCandidates(
      candidate("MCQ", "a", { candidateScore: 5_000 }),
      candidate("MCQ", "b", { candidateScore: 5_000 }),
    ) < 0,
  );
});