import assert from "node:assert/strict";
import test from "node:test";
import {
  deterministicDataLimitations,
  validateStudyInsightOutput,
} from "../shared/studyInsights.js";
import { buildStudyInsightGrounding } from "../server/features/study-insights/grounding.js";
import { makeStudyAnalyzerDto, validInsight } from "./study-insights-fixture.js";

test("valid structured insight requires exact grounded references", () => {
  const grounding = buildStudyInsightGrounding(makeStudyAnalyzerDto());
  const valid = validInsight();
  assert.deepEqual(validateStudyInsightOutput(valid, grounding, "en"), valid);
  assert.ok(validateStudyInsightOutput(validInsight("ar"), grounding, "ar"));

  const unknownFact = structuredClone(valid);
  unknownFact.observations[0]!.factIds = ["not-a-fact"];
  assert.equal(validateStudyInsightOutput(unknownFact, grounding, "en"), null);

  const unknownSignal = structuredClone(valid);
  unknownSignal.observations[0]!.factIds = ["weakness:another-user:scope:0"];
  assert.equal(validateStudyInsightOutput(unknownSignal, grounding, "en"), null);

  const unknownLecture = structuredClone(valid);
  unknownLecture.reviewPriorities[0]!.lectureId = "lecture-from-another-user";
  assert.equal(validateStudyInsightOutput(unknownLecture, grounding, "en"), null);

  const unknownSubject = structuredClone(valid);
  unknownSubject.reviewPriorities[0]!.subjectId = "subject-from-another-user";
  assert.equal(validateStudyInsightOutput(unknownSubject, grounding, "en"), null);

  const unknownItem = structuredClone(valid);
  (unknownItem.reviewPriorities[0] as typeof unknownItem.reviewPriorities[number] & { itemId: string }).itemId =
    "item-from-another-user";
  assert.equal(validateStudyInsightOutput(unknownItem, grounding, "en"), null);

  const unsupportedShape = { ...valid, extra: "not allowed" };
  assert.equal(validateStudyInsightOutput(unsupportedShape, grounding, "en"), null);

  const missingObservationEvidence = structuredClone(valid);
  missingObservationEvidence.observations[0]!.factIds = [];
  assert.equal(validateStudyInsightOutput(missingObservationEvidence, grounding, "en"), null);

  const missingPriorityEvidence = structuredClone(valid);
  missingPriorityEvidence.reviewPriorities[0]!.reasonFactIds = [];
  assert.equal(validateStudyInsightOutput(missingPriorityEvidence, grounding, "en"), null);

  const missingSuggestionEvidence = structuredClone(valid);
  missingSuggestionEvidence.studySuggestions[0]!.reasonFactIds = [];
  assert.equal(validateStudyInsightOutput(missingSuggestionEvidence, grounding, "en"), null);
});

test("unsafe or unsupported claims are rejected", () => {
  const grounding = buildStudyInsightGrounding(makeStudyAnalyzerDto());
  const cases = [
    "You completed 75 sessions.",
    "You completed seventy-five sessions.",
    "أكملت ثلاثة جلسات.",
    "Morning is your best study time.",
    "Longer sessions are more effective.",
    "These patterns indicate ADHD.",
    "You read 10 PDFs.",
    "Flashcards prove your accuracy is high.",
    "Skipped Recall means you failed.",
    "High points prove Mastery.",
    "Your performance is caused by this schedule.",
    "<script>alert(1)</script>",
    "Visit https://example.invalid",
    "Contact student@example.invalid",
  ];
  for (const text of cases) {
    const candidate = validInsight();
    candidate.summary = text;
    assert.equal(validateStudyInsightOutput(candidate, grounding, "en"), null, text);
  }
});

test("response arrays and Unicode text lengths are strictly bounded", () => {
  const grounding = buildStudyInsightGrounding(makeStudyAnalyzerDto());
  const tooManyObservations = validInsight();
  tooManyObservations.observations = Array.from({ length: 7 }, (_value, index) => ({
    id: `obs-${index + 1}`,
    text: "Supported observation.",
    factIds: ["mcq.objective_attempts.30d"],
  }));
  assert.equal(validateStudyInsightOutput(tooManyObservations, grounding, "en"), null);

  const tooLongHeadline = validInsight();
  tooLongHeadline.headline = "A".repeat(121);
  assert.equal(validateStudyInsightOutput(tooLongHeadline, grounding, "en"), null);

  const tooLongSummary = validInsight();
  tooLongSummary.summary = "ع".repeat(1_201);
  assert.equal(validateStudyInsightOutput(tooLongSummary, grounding, "en"), null);

  const tooLongSuggestion = validInsight();
  tooLongSuggestion.studySuggestions[0]!.text = "A".repeat(501);
  assert.equal(validateStudyInsightOutput(tooLongSuggestion, grounding, "en"), null);
});

test("supported time associations do not authorize causal or optimal-time claims", () => {
  const dto = makeStudyAnalyzerDto();
  dto.dataQuality.insufficientForTimeOfDayPattern = false;
  dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.status = "SUPPORTED_PATTERN";
  dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.bucket = "MORNING";
  const grounding = buildStudyInsightGrounding(dto);
  const association = validInsight();
  association.summary = "A morning study period is associated with objective outcomes.";
  assert.ok(validateStudyInsightOutput(association, grounding, "en"));

  const causal = validInsight();
  causal.summary = "Morning is the best time and causes stronger recall.";
  assert.equal(validateStudyInsightOutput(causal, grounding, "en"), null);
});

test("insufficient-pattern limitations come from deterministic localized copy", () => {
  const grounding = buildStudyInsightGrounding(makeStudyAnalyzerDto());
  assert.deepEqual(
    deterministicDataLimitations(grounding, "en"),
    [
      "There is not enough evidence to identify a study time-of-day pattern.",
      "There is not enough evidence to identify a session-length pattern.",
    ],
  );
  assert.match(deterministicDataLimitations(grounding, "ar")[0] ?? "", /أدلة كافية/u);
});