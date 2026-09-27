import assert from "node:assert/strict";
import test from "node:test";
import { STUDY_INSIGHT_MAX_GROUNDING_BYTES } from "../shared/studyInsights.js";
import {
  buildStudyInsightCacheKey,
  fingerprintStudyInsightGrounding,
} from "../server/features/study-insights/fingerprint.js";
import { buildStudyInsightGrounding } from "../server/features/study-insights/grounding.js";
import type { StudyAnalyzerDto } from "../server/features/study-analyzer/types.js";
import { makeStudyAnalyzerDto } from "./study-insights-fixture.js";

test("grounding is a bounded deterministic subset without volatile or private input", async () => {
  const dto = makeStudyAnalyzerDto() as StudyAnalyzerDto & Record<string, unknown>;
  dto.generatedAt = "2026-09-28T10:00:00.000Z";
  dto.asOf = "2026-09-28T10:00:00.000Z";
  dto.name = "Private Student Name";
  dto.email = "student@example.test";
  dto.quickNotes = [{ content: "private note content" }];
  dto.mcq = { question: "private question", correctAnswer: "private answer" };
  dto.flashcardText = "private card front and back";
  dto.integritySignals = [{ reason: "private integrity detail" }];
  dto.subjects = Array.from({ length: 200 }, (_value, index) => ({
    subjectId: `catalog-${index}`,
    note: "large irrelevant catalog payload",
  })) as unknown as StudyAnalyzerDto["subjects"];

  const grounding = buildStudyInsightGrounding(dto);
  const serialized = JSON.stringify(grounding);
  assert.ok(new TextEncoder().encode(serialized).byteLength <= STUDY_INSIGHT_MAX_GROUNDING_BYTES);
  assert.equal(serialized.includes("Private Student Name"), false);
  assert.equal(serialized.includes("student@example.test"), false);
  assert.equal(serialized.includes("private note content"), false);
  assert.equal(serialized.includes("private question"), false);
  assert.equal(serialized.includes("private answer"), false);
  assert.equal(serialized.includes("private card front"), false);
  assert.equal(serialized.includes("private integrity detail"), false);
  assert.equal(serialized.includes("large irrelevant catalog"), false);
  assert.equal("generatedAt" in grounding, false);
  assert.equal("asOf" in grounding, false);
  assert.equal("subjects" in grounding, false);
  assert.equal(grounding.dataQuality.trackedLectures, 2);
  assert.equal(grounding.recall.skipAndExpiryAreLearningFailures, false);
  assert.equal(grounding.flashcards.rememberedRateBps30d, 7_500);
});

test("semantic fingerprint is stable across generated timestamps and changes with facts or windows", async () => {
  const firstDto = makeStudyAnalyzerDto();
  const laterDto = makeStudyAnalyzerDto();
  laterDto.generatedAt = "2027-01-01T00:00:00.000Z";
  laterDto.asOf = "2027-01-01T00:00:00.000Z";
  const first = buildStudyInsightGrounding(firstDto);
  const later = buildStudyInsightGrounding(laterDto);
  assert.equal(
    await fingerprintStudyInsightGrounding(first),
    await fingerprintStudyInsightGrounding(later),
  );

  laterDto.activity.activeStudyDays.last30Days = 9;
  const changedFact = buildStudyInsightGrounding(laterDto);
  assert.notEqual(
    await fingerprintStudyInsightGrounding(first),
    await fingerprintStudyInsightGrounding(changedFact),
  );

  laterDto.activity.activeStudyDays.last30Days = 8;
  laterDto.windows.last30Days.to = "2026-09-28";
  const changedWindow = buildStudyInsightGrounding(laterDto);
  assert.notEqual(
    await fingerprintStudyInsightGrounding(first),
    await fingerprintStudyInsightGrounding(changedWindow),
  );

  const changedSignalDto = makeStudyAnalyzerDto();
  changedSignalDto.weaknesses[0]!.evidence.count = 4;
  assert.notEqual(
    await fingerprintStudyInsightGrounding(first),
    await fingerprintStudyInsightGrounding(buildStudyInsightGrounding(changedSignalDto)),
  );

  const changedReviewDto = makeStudyAnalyzerDto();
  changedReviewDto.retention.dueReviews[0]!.reviewState = "DUE";
  assert.notEqual(
    await fingerprintStudyInsightGrounding(first),
    await fingerprintStudyInsightGrounding(buildStudyInsightGrounding(changedReviewDto)),
  );
});

test("cache keys isolate users, locale, model, prompt, and grounding", async () => {
  const grounding = buildStudyInsightGrounding(makeStudyAnalyzerDto());
  const fingerprint = await fingerprintStudyInsightGrounding(grounding);
  const base = {
    userId: "user-a",
    locale: "en" as const,
    model: "model-a",
    groundingFingerprint: fingerprint,
  };
  const key = await buildStudyInsightCacheKey(base);
  assert.equal(key.length < 240, true);
  assert.equal(key.includes("user-a"), false);
  assert.notEqual(key, await buildStudyInsightCacheKey({ ...base, userId: "user-b" }));
  assert.notEqual(key, await buildStudyInsightCacheKey({ ...base, locale: "ar" }));
  assert.notEqual(key, await buildStudyInsightCacheKey({ ...base, model: "model-b" }));
  assert.notEqual(
    key,
    await buildStudyInsightCacheKey({ ...base, groundingFingerprint: "a".repeat(64) }),
  );
});