import assert from "node:assert/strict";
import test from "node:test";
import {
  STUDY_INSIGHT_PROMPT_VERSION,
  STUDY_INSIGHT_VERSION,
} from "../shared/studyInsights.js";
import { createStudyInsightService } from "../server/features/study-insights/service.js";
import { buildStudyInsightGrounding } from "../server/features/study-insights/grounding.js";
import { fingerprintStudyInsightGrounding } from "../server/features/study-insights/fingerprint.js";
import { DEFAULT_CLOUDFLARE_MODEL } from "../server/services/ai/config.js";
import { makeStudyAnalyzerDto, validInsight } from "./study-insights-fixture.js";

function emptyAnalyzer() {
  const dto = makeStudyAnalyzerDto();
  dto.activity.activeStudyDays.last7Days = 0;
  dto.activity.activeStudyDays.last30Days = 0;
  dto.focus.meaningfulCompletedSessions.last30Days = 0;
  dto.focus.verifiedFocusSeconds.last30Days = 0;
  dto.objectivePractice.combinedObjective.last30Days.attempts = 0;
  dto.flashcards.reviews.last30Days.meaningfulReviews = 0;
  dto.recall.periodicActivity.last30Days.answered = 0;
  dto.retention.due = 0;
  dto.retention.overdue = 0;
  dto.retention.needsReview = 0;
  dto.retention.dueReviews = [];
  dto.dataQuality.trackedLectureCount = 0;
  dto.mastery.trackedLectureCount = 0;
  dto.mastery.effectiveMasteryDistributionFreshOnly = {};
  dto.objectivePractice.repeatedErrors = [];
  dto.weaknesses = [];
  dto.positives = [];
  return dto;
}

test("insufficient Analyzer data short-circuits before the internal Worker", async () => {
  let workerCalls = 0;
  const service = createStudyInsightService({
    environment: { AI_STUDY_INSIGHTS_CACHE_ENABLED: "false" },
    readAnalyzer: async () => emptyAnalyzer(),
    callWorker: async () => {
      workerCalls += 1;
      throw new Error("must not run");
    },
  });
  const result = await service({ userId: "self", locale: "en" });
  assert.equal(result.status, "INSUFFICIENT_DATA");
  assert.equal(result.source, "DETERMINISTIC_FALLBACK");
  assert.equal(workerCalls, 0);
});

test("provider failure returns explicitly deterministic Prompt 36 fallback", async () => {
  const service = createStudyInsightService({
    environment: { AI_STUDY_INSIGHTS_CACHE_ENABLED: "false" },
    readAnalyzer: async () => makeStudyAnalyzerDto(),
    callWorker: async () => { throw new Error("private provider failure"); },
  });
  const result = await service({ userId: "self", locale: "ar" });
  assert.equal(result.status, "AI_UNAVAILABLE");
  assert.equal(result.source, "DETERMINISTIC_FALLBACK");
  assert.equal("insight" in result, false);
  assert.ok(result.deterministicSummary.weaknessSignalIds.length > 0);
});

test("one local single-flight shares validated output for identical user facts", async () => {
  let workerCalls = 0;
  let cacheEnabled = true;
  let requestBody: unknown;
  const model = "test-study-model";
  const service = createStudyInsightService({
    environment: {
      AI_STUDY_INSIGHTS_CACHE_ENABLED: "true",
      CLOUDFLARE_AI_STUDY_INSIGHT_MODEL: model,
    },
    readAnalyzer: async () => makeStudyAnalyzerDto(),
    callWorker: async (input) => {
      workerCalls += 1;
      cacheEnabled = input.cacheEnabled;
      requestBody = input.request;
      const groundingFingerprint = await fingerprintStudyInsightGrounding(input.request.grounding);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        status: "ok" as const,
        cacheHit: false,
        entry: {
          insightVersion: STUDY_INSIGHT_VERSION,
          promptVersion: STUDY_INSIGHT_PROMPT_VERSION,
          analyzerVersion: input.request.grounding.analyzerVersion,
          groundingFingerprint,
          locale: input.request.locale,
          generatedAt: "2026-09-27T10:00:00.000Z",
          model,
          output: validInsight(input.request.locale),
        },
      };
    },
  });

  const results = await Promise.all(Array.from({ length: 20 }, () =>
    service({ userId: "private-user-identity-123", locale: "en" })));
  assert.equal(workerCalls, 1);
  assert.equal(cacheEnabled, true);
  assert.equal(results.every((result) => result.status === "READY"), true);
  const readyResults = results.filter((result) => result.status === "READY");
  assert.equal(readyResults.length, 20);
  const first = readyResults[0];
  assert.ok(first);
  assert.equal(readyResults.every((result) => JSON.stringify(result.insight) === JSON.stringify(first.insight)), true);
  assert.equal(first.cacheHit, false);
  assert.equal(first.insight.dataLimitations.length, 2);
  assert.ok(requestBody && typeof requestBody === "object");
  assert.deepEqual(Object.keys(requestBody), ["requestVersion", "promptVersion", "locale", "grounding"]);
  assert.equal(JSON.stringify(requestBody).includes("private-user-identity-123"), false);
  assert.equal(first.insightVersion, STUDY_INSIGHT_VERSION);
  assert.equal(first.analyzerVersion, "study-analyzer-v1");
  assert.equal(first.generatedAt, "2026-09-27T10:00:00.000Z");
});

test("cache disabled flag is forwarded as a hard no-cache instruction", async () => {
  let forwardedCacheFlag: boolean | undefined;
  const service = createStudyInsightService({
    environment: {
      AI_STUDY_INSIGHTS_CACHE_ENABLED: "false",
      CLOUDFLARE_AI_STUDY_INSIGHT_MODEL: DEFAULT_CLOUDFLARE_MODEL,
    },
    readAnalyzer: async () => makeStudyAnalyzerDto(),
    callWorker: async (input) => {
      forwardedCacheFlag = input.cacheEnabled;
      const groundingFingerprint = await fingerprintStudyInsightGrounding(input.request.grounding);
      return {
        status: "ok",
        cacheHit: false,
        entry: {
          insightVersion: STUDY_INSIGHT_VERSION,
          promptVersion: STUDY_INSIGHT_PROMPT_VERSION,
          analyzerVersion: input.request.grounding.analyzerVersion,
          groundingFingerprint,
          locale: input.request.locale,
          generatedAt: "2026-09-27T10:00:00.000Z",
          model: DEFAULT_CLOUDFLARE_MODEL,
          output: validInsight(input.request.locale),
        },
      };
    },
  });
  await service({ userId: "cache-off-user", locale: "en" });
  assert.equal(forwardedCacheFlag, false);
});

test("fallback and success paths derive only from Prompt 36 DTO facts", async () => {
  const grounding = buildStudyInsightGrounding(makeStudyAnalyzerDto());
  assert.equal(grounding.analyzerVersion, "study-analyzer-v1");
  assert.equal(grounding.facts.some((fact) => fact.id === "mcq.objective_attempts.30d"), true);
  assert.equal(grounding.facts.some((fact) => fact.id.includes("name") || fact.id.includes("email")), false);
});