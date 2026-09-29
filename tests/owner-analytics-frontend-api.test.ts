import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getOwnerAcademicAnalytics,
  getOwnerAnalyticsLectures,
  OwnerAnalyticsRequestError,
  type OwnerAcademicAnalyticsResponse,
  type OwnerAnalyticsLectureListResponse,
} from "../src/features/owner-analytics/api";

type MockRequester = NonNullable<Parameters<typeof getOwnerAcademicAnalytics>[1]>;

function mockRequester(payload: unknown, status = 200) {
  const calls: Array<{ path: string; options?: Record<string, unknown> }> = [];
  const requester = (async (path: string, options?: unknown) => {
    calls.push({
      path,
      options: options as Record<string, unknown> | undefined,
    });
    return new Response(JSON.stringify(payload), { status });
  }) as MockRequester;
  return { requester, calls };
}

const envelope = {
  analyticsVersion: "owner-academic-analytics-v1",
  privacy: {
    policyVersion: "owner-analytics-privacy-v1",
    minimumContributors: 10,
    minimumRateInteractions: 20,
  },
  window: {
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-09-30T00:00:00.000Z",
    asOf: "2026-09-30T00:00:00.000Z",
  },
};

test("academic analytics requests an explicit window without caching", async () => {
  const payload = {
    ...envelope,
    analyticsStatus: "NO_DATA",
    eligibleStudents: 0,
    subjects: [],
  } as unknown as OwnerAcademicAnalyticsResponse;
  const { requester, calls } = mockRequester(payload);

  const result = await getOwnerAcademicAnalytics("LAST_30_DAYS", requester);

  assert.deepEqual(result.subjects, []);
  assert.equal(calls[0]?.path, "/api/admin/owner-analytics/academic?window=LAST_30_DAYS");
  assert.equal(calls[0]?.options?.cache, "no-store");
  assert.equal(calls[0]?.options?.bypassCache, true);
  assert.equal(calls[0]?.options?.retries, 0);
});

test("lecture analytics scopes requests to the selected subject and cursor", async () => {
  const payload = {
    ...envelope,
    lectures: [],
    pageInfo: { limit: 25, nextCursor: null },
  } as unknown as OwnerAnalyticsLectureListResponse;
  const { requester, calls } = mockRequester(payload);

  await getOwnerAnalyticsLectures("LAST_7_DAYS", {
    subjectId: "subject & one",
    cursor: "next / page",
    limit: 25,
  }, requester);

  const requestUrl = new URL(calls[0]!.path, "https://example.test");
  assert.equal(requestUrl.searchParams.get("window"), "LAST_7_DAYS");
  assert.equal(requestUrl.searchParams.get("subjectId"), "subject & one");
  assert.equal(requestUrl.searchParams.get("cursor"), "next / page");
  assert.equal(requestUrl.searchParams.get("limit"), "25");
  assert.equal(calls[0]?.options?.cache, "no-store");
});

test("analytics requests preserve server failures and reject an unexpected envelope", async () => {
  const unavailable = mockRequester({}, 503);
  await assert.rejects(
    getOwnerAcademicAnalytics("CURRENT_SEMESTER", unavailable.requester),
    (error: unknown) => error instanceof OwnerAnalyticsRequestError && error.status === 503,
  );

  const invalid = mockRequester({
    ...envelope,
    analyticsVersion: "unexpected-version",
    subjects: [],
  });
  await assert.rejects(
    getOwnerAcademicAnalytics("LAST_30_DAYS", invalid.requester),
    (error: unknown) => error instanceof OwnerAnalyticsRequestError && error.status === 502,
  );
});