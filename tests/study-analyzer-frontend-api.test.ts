import assert from "node:assert/strict";
import test from "node:test";
import {
  askMyStudyData,
  getStudyAnalyzer,
  getStudyInsight,
  StudyAnalyzerRequestError,
} from "../src/features/study-analyzer/api.js";
import type { StudyAnalyzerDto } from "../server/features/study-analyzer/types.js";

type RequestOptions = RequestInit & {
  bypassCache?: boolean;
  ttl?: number;
  retries?: number;
  silent?: boolean;
};
type Requester = (input: RequestInfo | URL, options?: RequestOptions) => Promise<Response>;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("Analyzer read is a private no-store request with no client-selected identity or window", async () => {
  const dto = {
    analyzerVersion: "study-analyzer-v1",
    windows: { last7Days: {}, last30Days: {}, currentSemester: {} },
  } as unknown as StudyAnalyzerDto;
  let requestUrl = "";
  let requestOptions: RequestOptions | undefined;
  const requester: Requester = async (input, options) => {
    requestUrl = String(input);
    requestOptions = options;
    return jsonResponse(dto);
  };

  assert.deepEqual(await getStudyAnalyzer(requester), dto);
  assert.equal(requestUrl, "/api/me/study-analyzer");
  assert.equal(requestOptions?.method, "GET");
  assert.equal(requestOptions?.bypassCache, true);
  assert.equal(requestOptions?.ttl, 0);
  assert.equal(requestOptions?.retries, 0);
  assert.equal(requestOptions?.cache, "no-store");
  assert.equal(requestOptions?.body, undefined);
});

test("Study Insight uses the canonical locale query and does not send a refresh override", async () => {
  let requestUrl = "";
  let requestOptions: RequestOptions | undefined;
  const requester: Requester = async (input, options) => {
    requestUrl = String(input);
    requestOptions = options;
    return jsonResponse({ status: "AI_UNAVAILABLE", source: "DETERMINISTIC_FALLBACK" });
  };

  await getStudyInsight("ar", requester);
  assert.equal(requestUrl, "/api/me/study-insights?locale=ar");
  assert.equal(requestOptions?.method, "GET");
  assert.equal(requestOptions?.bypassCache, true);
  assert.equal(requestOptions?.cache, "no-store");
  assert.equal(requestOptions?.body, undefined);
});

test("Ask My Study Data submits only the question and locale to Prompt38", async () => {
  let requestUrl = "";
  let requestOptions: RequestOptions | undefined;
  const requester: Requester = async (input, options) => {
    requestUrl = String(input);
    requestOptions = options;
    return jsonResponse({ status: "UNSUPPORTED" });
  };

  await askMyStudyData("What should I review?", "en", requester);
  assert.equal(requestUrl, "/api/me/study-data/ask");
  assert.equal(requestOptions?.method, "POST");
  assert.equal(requestOptions?.cache, "no-store");
  assert.equal(requestOptions?.bypassCache, true);
  assert.deepEqual(JSON.parse(String(requestOptions?.body)), {
    question: "What should I review?",
    locale: "en",
  });
});

test("failed API responses expose only the status to UI callers", async () => {
  const requester: Requester = async () => jsonResponse({ error: "private backend detail" }, 503);
  await assert.rejects(getStudyAnalyzer(requester), (error: unknown) => {
    assert.ok(error instanceof StudyAnalyzerRequestError);
    assert.equal(error.status, 503);
    assert.equal(error.message, "Study Analyzer request failed.");
    return true;
  });
});

test("unexpected Analyzer versions are rejected", async () => {
  const requester: Requester = async () => jsonResponse({
    analyzerVersion: "study-analyzer-v2",
    windows: {},
  });
  await assert.rejects(getStudyAnalyzer(requester), (error: unknown) => {
    assert.ok(error instanceof StudyAnalyzerRequestError);
    assert.equal(error.status, 502);
    return true;
  });
});