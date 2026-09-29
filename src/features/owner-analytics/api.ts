import type {
  OwnerSafeAcademicAnalytics,
  OwnerSafeLecture,
  OwnerSafeScope,
  OwnerSafeSubject,
} from "../../../server/features/owner-analytics/privacy";
import type { OwnerAnalyticsWindowPreset } from "../../../server/features/owner-analytics/windows";
import { apiClient } from "../../core/api/apiClient";

type Requester = typeof apiClient;
type ApiOptions = Parameters<Requester>[1];
type AnalyticsEnvelope = Pick<
  OwnerSafeAcademicAnalytics,
  "analyticsVersion" | "privacy" | "window"
>;

/**
 * The academic route intentionally flattens the safe cohort scope into the
 * response while the privacy transformer returns it under `cohort`.
 */
export type OwnerAcademicAnalyticsResponse = AnalyticsEnvelope
  & OwnerSafeScope
  & { subjects: OwnerSafeSubject[] };

export type OwnerAnalyticsLectureListResponse = AnalyticsEnvelope & {
  lectures: OwnerSafeLecture[];
  pageInfo: {
    limit: number;
    nextCursor: string | null;
  };
};

export class OwnerAnalyticsRequestError extends Error {
  constructor(readonly status: number) {
    super("Owner analytics request failed.");
    this.name = "OwnerAnalyticsRequestError";
  }
}

async function requestJson<T>(
  requester: Requester,
  path: string,
  options: ApiOptions,
): Promise<T> {
  try {
    const response = await requester(path, options);
    if (!response.ok) throw new OwnerAnalyticsRequestError(response.status);
    return await response.json() as T;
  } catch (error) {
    if (error instanceof OwnerAnalyticsRequestError) throw error;
    const status = typeof error === "object" && error !== null && "status" in error &&
      typeof error.status === "number"
      ? error.status
      : 0;
    throw new OwnerAnalyticsRequestError(status);
  }
}

function readOptions(): ApiOptions {
  return {
    method: "GET",
    cache: "no-store",
    bypassCache: true,
    ttl: 0,
    retries: 0,
    silent: true,
  };
}

function assertEnvelope(value: AnalyticsEnvelope): void {
  if (
    value?.analyticsVersion !== "owner-academic-analytics-v1"
    || value?.privacy?.policyVersion !== "owner-analytics-privacy-v1"
    || !value?.window
  ) {
    throw new OwnerAnalyticsRequestError(502);
  }
}

export async function getOwnerAcademicAnalytics(
  window: OwnerAnalyticsWindowPreset,
  requester: Requester = apiClient,
): Promise<OwnerAcademicAnalyticsResponse> {
  const response = await requestJson<OwnerAcademicAnalyticsResponse>(
    requester,
    `/api/admin/owner-analytics/academic?window=${window}`,
    readOptions(),
  );
  assertEnvelope(response);
  if (!Array.isArray(response.subjects)) throw new OwnerAnalyticsRequestError(502);
  return response;
}

export async function getOwnerAnalyticsLectures(
  window: OwnerAnalyticsWindowPreset,
  options: {
    subjectId?: string;
    cursor?: string;
    limit?: number;
  } = {},
  requester: Requester = apiClient,
): Promise<OwnerAnalyticsLectureListResponse> {
  const query = new URLSearchParams({ window });
  if (options.subjectId) query.set("subjectId", options.subjectId);
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.limit !== undefined) query.set("limit", String(options.limit));

  const response = await requestJson<OwnerAnalyticsLectureListResponse>(
    requester,
    `/api/admin/owner-analytics/lectures?${query.toString()}`,
    readOptions(),
  );
  assertEnvelope(response);
  if (
    !Array.isArray(response.lectures)
    || !response.pageInfo
    || typeof response.pageInfo.limit !== "number"
    || (response.pageInfo.nextCursor !== null && typeof response.pageInfo.nextCursor !== "string")
  ) {
    throw new OwnerAnalyticsRequestError(502);
  }
  return response;
}