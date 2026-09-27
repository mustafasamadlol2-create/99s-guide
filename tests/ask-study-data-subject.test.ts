import assert from "node:assert/strict";
import test from "node:test";
import { createAskMyStudyDataService } from "../server/features/ask-study-data/service.js";
import { routeAskStudyDataQuestion } from "../server/features/ask-study-data/routing.js";
import { makeStudyAnalyzerDto } from "./study-insights-fixture.js";

const ENV = {
  ASK_MY_STUDY_DATA_ENABLED: "true",
  ASK_MY_STUDY_DATA_AI_ENABLED: "true",
};

function subjectDto() {
  const dto = makeStudyAnalyzerDto();
  dto.subjects = [
    {
      subjectId: "Cardiology",
      activeStudyDaysLast30Days: 6,
      meaningfulFocusSecondsLast30Days: 7_200,
      objectiveAttemptsLast30Days: 10,
      objectiveCorrectLast30Days: 7,
      objectiveAccuracyRateBpsLast30Days: 7_000,
      flashcardReviewsLast30Days: 4,
      recallAnsweredLast30Days: 2,
      trackedLectures: 3,
      effectiveMasteryDistributionFreshOnly: { DEVELOPING: 2 },
      dueReviewCount: 1,
    },
    {
      subjectId: "Neurology",
      activeStudyDaysLast30Days: 3,
      meaningfulFocusSecondsLast30Days: 3_600,
      objectiveAttemptsLast30Days: 5,
      objectiveCorrectLast30Days: 2,
      objectiveAccuracyRateBpsLast30Days: 4_000,
      flashcardReviewsLast30Days: 1,
      recallAnsweredLast30Days: 0,
      trackedLectures: 2,
      effectiveMasteryDistributionFreshOnly: { NEEDS_REVIEW: 2 },
      dueReviewCount: 2,
    },
  ];
  return dto;
}

test("subject-specific questions resolve exact canonical subject labels and only return that subject", async () => {
  assert.equal(
    routeAskStudyDataQuestion("What is my subject activity in Cardiology?").intent,
    "SUBJECT_ACTIVITY",
  );
  assert.equal(
    routeAskStudyDataQuestion("How was my objective accuracy by subject?").intent,
    "SUBJECT_ACTIVITY",
  );
  let workerCalls = 0;
  const service = createAskMyStudyDataService({
    environment: ENV,
    now: () => new Date("2026-09-27T10:00:00.000Z"),
    readAnalyzer: async () => subjectDto(),
    callWorker: async () => {
      workerCalls += 1;
      return null;
    },
  });
  const result = await service({
    userId: "student-1",
    question: "How many active study days did I have in Cardiology?",
    locale: "en",
  });
  assert.equal(result.status, "ANSWERED");
  if (result.status !== "ANSWERED") return;
  assert.equal(result.source, "DETERMINISTIC");
  assert.equal(result.intent, "SUBJECT_ACTIVITY");
  assert.match(result.answer, /Cardiology/u);
  assert.match(result.answer, /last-30-day active study days 6/u);
  assert.match(result.answer, /verified Focus seconds 7200/u);
  assert.doesNotMatch(result.answer, /Neurology/u);
  assert.deepEqual(result.evidence.map((entry) => entry.factIds.length), [5]);
  assert.deepEqual(result.evidence[0]?.subjectIds, ["Cardiology"]);
  assert.equal(workerCalls, 0);
});

test("unmatched subject names ask for clarification with only bounded accessible candidates", async () => {
  const service = createAskMyStudyDataService({
    environment: ENV,
    readAnalyzer: async () => subjectDto(),
    callWorker: async () => {
      throw new Error("Worker must not be called for subject clarification.");
    },
  });
  const result = await service({
    userId: "student-1",
    question: "What is my subject activity in Dermatology?",
    locale: "en",
  });
  assert.equal(result.status, "NEEDS_CLARIFICATION");
  if (result.status !== "NEEDS_CLARIFICATION") return;
  assert.deepEqual(result.candidates, ["Cardiology", "Neurology"]);
});

test("best or worst subject requests avoid unsupported rankings", async () => {
  const service = createAskMyStudyDataService({
    environment: ENV,
    readAnalyzer: async () => subjectDto(),
    callWorker: async () => {
      throw new Error("Subject ranking must remain deterministic.");
    },
  });
  const result = await service({
    userId: "student-1",
    question: "What is my best subject?",
    locale: "en",
  });
  assert.equal(result.status, "ANSWERED");
  if (result.status !== "ANSWERED") return;
  assert.match(result.answer, /does not calculate a single best or worst subject score/u);
  assert.equal(result.limitations.length, 3);
});