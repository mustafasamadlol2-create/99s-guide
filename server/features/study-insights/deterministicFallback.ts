import {
  STUDY_INSIGHT_PROMPT_VERSION,
  STUDY_INSIGHT_VERSION,
  type StudyInsightLocale,
} from "../../../shared/studyInsights.js";
import type {
  StudyInsightGroundingV1,
  StudyInsightResponse,
} from "./types.js";

export function buildDeterministicStudyInsightFallback(
  grounding: StudyInsightGroundingV1,
  groundingFingerprint: string,
  locale: StudyInsightLocale,
  status: "AI_UNAVAILABLE" | "INSUFFICIENT_DATA",
): StudyInsightResponse {
  return {
    status,
    source: "DETERMINISTIC_FALLBACK",
    insightVersion: STUDY_INSIGHT_VERSION,
    promptVersion: STUDY_INSIGHT_PROMPT_VERSION,
    analyzerVersion: grounding.analyzerVersion,
    groundingFingerprint,
    locale,
    deterministicSummary: {
      weaknessSignalIds: grounding.weaknesses.slice(0, 5).map((signal) => signal.signalId),
      positiveSignalIds: grounding.positives.slice(0, 5).map((signal) => signal.signalId),
      dueReviewCount: grounding.retention.due,
      objectiveTrend: grounding.objectivePractice.trend,
      consistencyTrend: grounding.activity.consistencyTrend,
    },
  };
}