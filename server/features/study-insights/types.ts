import type { StudyAnalyzerDto } from "../study-analyzer/types.js";
import type {
  StudyInsightCacheEntry,
  StudyInsightGroundingV1,
  StudyInsightLocale,
  StudyInsightV1,
} from "../../../shared/studyInsights.js";

export type {
  StudyInsightCacheEntry,
  StudyInsightGroundingV1,
  StudyInsightLocale,
  StudyInsightV1,
};

export type StudyInsightWorkerRequest = {
  requestVersion: "study-insight-v1";
  promptVersion: "study-insight-prompt-v1";
  locale: StudyInsightLocale;
  grounding: StudyInsightGroundingV1;
};

export type StudyInsightWorkerResponse = {
  status: "ok";
  cacheHit: boolean;
  entry: StudyInsightCacheEntry;
};

export type StudyInsightResponse =
  | {
      status: "READY";
      source: "AI";
      insightVersion: "study-insight-v1";
      promptVersion: "study-insight-prompt-v1";
      analyzerVersion: "study-analyzer-v1";
      groundingFingerprint: string;
      cacheHit: boolean;
      insight: StudyInsightV1;
      generatedAt: string;
    }
  | {
      status: "AI_UNAVAILABLE" | "INSUFFICIENT_DATA";
      source: "DETERMINISTIC_FALLBACK";
      insightVersion: "study-insight-v1";
      promptVersion: "study-insight-prompt-v1";
      analyzerVersion: "study-analyzer-v1";
      groundingFingerprint: string;
      locale: StudyInsightLocale;
      deterministicSummary: {
        weaknessSignalIds: string[];
        positiveSignalIds: string[];
        dueReviewCount: number | null;
        objectiveTrend: string;
        consistencyTrend: string;
      };
    };

export type StudyInsightAnalyzerReader = (userId: string) => Promise<StudyAnalyzerDto>;