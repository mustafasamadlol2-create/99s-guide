import type { StudyAnalyzerDto } from "../../../server/features/study-analyzer/types";
import type { StudyInsightLocale, StudyInsightResponse } from "../../../server/features/study-insights/types";
import type { AskMyStudyDataResponse } from "../../../server/features/ask-study-data/types";
import { apiClient } from "../../core/api/apiClient";

type Requester = typeof apiClient;

export class StudyAnalyzerRequestError extends Error {
  constructor(readonly status: number) {
    super("Study Analyzer request failed.");
    this.name = "StudyAnalyzerRequestError";
  }
}

async function requestJson<T>(
  requester: Requester,
  path: string,
  options: Parameters<Requester>[1],
): Promise<T> {
  try {
    const response = await requester(path, options);
    if (!response.ok) throw new StudyAnalyzerRequestError(response.status);
    return await response.json() as T;
  } catch (error) {
    if (error instanceof StudyAnalyzerRequestError) throw error;
    const status = typeof error === "object" && error !== null && "status" in error &&
      typeof error.status === "number"
      ? error.status
      : 0;
    throw new StudyAnalyzerRequestError(status);
  }
}

export async function getStudyAnalyzer(requester: Requester = apiClient): Promise<StudyAnalyzerDto> {
  const dto = await requestJson<StudyAnalyzerDto>(requester, "/api/me/study-analyzer", {
    method: "GET",
    cache: "no-store",
    bypassCache: true,
    ttl: 0,
    retries: 0,
    silent: true,
  });
  if (dto?.analyzerVersion !== "study-analyzer-v1" || !dto.windows) {
    throw new StudyAnalyzerRequestError(502);
  }
  return dto;
}

export async function getStudyInsight(
  locale: StudyInsightLocale,
  requester: Requester = apiClient,
): Promise<StudyInsightResponse> {
  return requestJson<StudyInsightResponse>(requester, `/api/me/study-insights?locale=${locale}`, {
    method: "GET",
    cache: "no-store",
    bypassCache: true,
    ttl: 0,
    retries: 0,
    silent: true,
  });
}

export async function askMyStudyData(
  question: string,
  locale: StudyInsightLocale,
  requester: Requester = apiClient,
): Promise<AskMyStudyDataResponse> {
  return requestJson<AskMyStudyDataResponse>(requester, "/api/me/study-data/ask", {
    method: "POST",
    cache: "no-store",
    bypassCache: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, locale }),
    silent: true,
  });
}