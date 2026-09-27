import assert from "node:assert/strict";
import test from "node:test";
import worker from "../cloudflare-personalization-api/src/index.js";
import type { StudyInsightsWorkerEnvironment } from "../cloudflare-personalization-api/src/studyInsights.js";
import { STUDY_INSIGHT_TTL_SECONDS, STUDY_INSIGHT_VERSION, STUDY_INSIGHT_PROMPT_VERSION } from "../shared/studyInsights.js";
import { buildStudyInsightGrounding } from "../server/features/study-insights/grounding.js";
import { buildStudyInsightCacheKey, fingerprintStudyInsightGrounding } from "../server/features/study-insights/fingerprint.js";
import { makeStudyAnalyzerDto, validInsight } from "./study-insights-fixture.js";

const SECRET = "local-test-secret";
const MODEL = "test-study-model";

class TestKv {
  values = new Map<string, string>();
  reads = 0;
  writes = 0;
  ttls: Array<number | undefined> = [];
  failRead = false;
  failWrite = false;

  async get(key: string): Promise<string | null> {
    this.reads += 1;
    if (this.failRead) throw new Error("local KV read failure");
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.writes += 1;
    this.ttls.push(options?.expirationTtl);
    if (this.failWrite) throw new Error("local KV write failure");
    this.values.set(key, value);
  }
}

function environment(kv = new TestKv(), run?: (model: string, input: Record<string, unknown>) => Promise<unknown>) {
  let aiCalls = 0;
  const env: StudyInsightsWorkerEnvironment = {
    PERSONALIZATION_KV: kv,
    PERSONALIZATION_SYNC_SECRET: SECRET,
    AI_STUDY_INSIGHTS_ENABLED: "true",
    AI_STUDY_INSIGHTS_CACHE_ENABLED: "true",
    CLOUDFLARE_AI_STUDY_INSIGHT_MODEL: MODEL,
    AI: {
      run: async (model, input) => {
        aiCalls += 1;
        return run ? run(model, input) : { response: JSON.stringify(validInsight("en")) };
      },
    },
  };
  return { env, kv, get aiCalls() { return aiCalls; } };
}

async function requestFor(
  env: StudyInsightsWorkerEnvironment,
  options: { secret?: string; locale?: "ar" | "en"; bodyExtra?: Record<string, unknown> } = {},
) {
  const locale = options.locale ?? "en";
  const grounding = buildStudyInsightGrounding(makeStudyAnalyzerDto());
  const groundingFingerprint = await fingerprintStudyInsightGrounding(grounding);
  const cacheKey = await buildStudyInsightCacheKey({
    userId: "user-not-sent-to-worker",
    locale,
    model: MODEL,
    groundingFingerprint,
  });
  const body = {
    requestVersion: STUDY_INSIGHT_VERSION,
    promptVersion: STUDY_INSIGHT_PROMPT_VERSION,
    locale,
    grounding,
    ...options.bodyExtra,
  };
  return new Request("https://worker.test/internal/ai/study-insights", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-personalization-sync-secret": options.secret ?? SECRET,
      "x-study-insight-cache-key": cacheKey,
      "x-study-insight-cache-enabled": "true",
      "x-study-insight-model": MODEL,
    },
    body: JSON.stringify(body),
  });
}

test("Worker internal route authenticates before reading cache or invoking AI", async () => {
  const fixture = environment();
  const request = await requestFor(fixture.env, { secret: "wrong-secret" });
  const response = await worker.fetch(request, fixture.env as never);
  assert.equal(response.status, 401);
  assert.equal(fixture.kv.reads, 0);
  assert.equal(fixture.aiCalls, 0);
});

test("feature-off Worker makes no KV or AI calls", async () => {
  const fixture = environment();
  fixture.env.AI_STUDY_INSIGHTS_ENABLED = "false";
  const request = await requestFor(fixture.env);
  const response = await worker.fetch(request, fixture.env as never);
  assert.equal(response.status, 404);
  assert.equal(fixture.kv.reads, 0);
  assert.equal(fixture.kv.writes, 0);
  assert.equal(fixture.aiCalls, 0);
});

test("validated cache miss writes only bounded structured output with the frozen TTL", async () => {
  let capturedMessages = "";
  let capturedModel = "";
  const fixture = environment(undefined, async (model, input) => {
    capturedModel = model;
    capturedMessages = JSON.stringify(input.messages);
    return { response: JSON.stringify(validInsight("en")) };
  });
  const request = await requestFor(fixture.env);
  const response = await worker.fetch(request, fixture.env as never);
  const payload = await response.json() as Record<string, any>;
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(payload.status, "ok");
  assert.equal(payload.cacheHit, false);
  assert.equal(fixture.aiCalls, 1);
  assert.equal(fixture.kv.writes, 1);
  assert.deepEqual(fixture.kv.ttls, [STUDY_INSIGHT_TTL_SECONDS]);
  assert.equal(capturedModel, MODEL);
  assert.equal(capturedMessages.includes("user-not-sent-to-worker"), false);
  assert.equal(Object.hasOwn(payload.entry, "grounding"), false);
  assert.equal(payload.entry.output.dataLimitations.length, 2);
});

test("validated private KV entry serves a cache hit without another AI call", async () => {
  const fixture = environment();
  const request = await requestFor(fixture.env);
  const first = await worker.fetch(request, fixture.env as never);
  assert.equal(first.status, 200);
  const second = await worker.fetch(await requestFor(fixture.env), fixture.env as never);
  const payload = await second.json() as Record<string, any>;
  assert.equal(second.status, 200);
  assert.equal(payload.cacheHit, true);
  assert.equal(fixture.aiCalls, 1);
  assert.equal(fixture.kv.writes, 1);
});

test("cache-off flag performs neither KV reads nor KV writes", async () => {
  const fixture = environment();
  fixture.env.AI_STUDY_INSIGHTS_CACHE_ENABLED = "false";
  const response = await worker.fetch(await requestFor(fixture.env), fixture.env as never);
  assert.equal(response.status, 200);
  assert.equal(fixture.aiCalls, 1);
  assert.equal(fixture.kv.reads, 0);
  assert.equal(fixture.kv.writes, 0);
});

test("Arabic Worker generation returns a validated Arabic insight", async () => {
  const fixture = environment(undefined, async (_model, input) => {
    const messages = input.messages as Array<{ role: string; content: string }>;
    const userMessage = messages.find((message) => message.role === "user")?.content ?? "";
    assert.match(userMessage, /Requested locale: ar/u);
    return { response: JSON.stringify(validInsight("ar")) };
  });
  const response = await worker.fetch(
    await requestFor(fixture.env, { locale: "ar" }),
    fixture.env as never,
  );
  const payload = await response.json() as Record<string, any>;
  assert.equal(response.status, 200);
  assert.equal(payload.entry.locale, "ar");
  assert.equal(payload.entry.output.locale, "ar");
});

test("corrupt cache entries are misses and never returned to the student", async () => {
  const fixture = environment();
  const request = await requestFor(fixture.env);
  const cacheKey = request.headers.get("x-study-insight-cache-key");
  assert.ok(cacheKey);
  fixture.kv.values.set(cacheKey, "{not-json");
  const response = await worker.fetch(request, fixture.env as never);
  const payload = await response.json() as Record<string, any>;
  assert.equal(response.status, 200);
  assert.equal(payload.cacheHit, false);
  assert.equal(fixture.aiCalls, 1);
});

test("expired cache entries are misses", async () => {
  const fixture = environment();
  const request = await requestFor(fixture.env);
  const cacheKey = request.headers.get("x-study-insight-cache-key");
  assert.ok(cacheKey);
  const firstResponse = await worker.fetch(request, fixture.env as never);
  assert.equal(firstResponse.status, 200);
  const stored = JSON.parse(fixture.kv.values.get(cacheKey) ?? "null") as Record<string, unknown>;
  stored.generatedAt = new Date(Date.now() - (STUDY_INSIGHT_TTL_SECONDS + 10) * 1_000).toISOString();
  fixture.kv.values.set(cacheKey, JSON.stringify(stored));

  const secondResponse = await worker.fetch(await requestFor(fixture.env), fixture.env as never);
  const payload = await secondResponse.json() as Record<string, any>;
  assert.equal(secondResponse.status, 200);
  assert.equal(payload.cacheHit, false);
  assert.equal(fixture.aiCalls, 2);
});

test("unknown references and malformed model output get one bounded repair only", async () => {
  let responseCount = 0;
  const fixture = environment(undefined, async () => {
    responseCount += 1;
    const invalid = validInsight("en");
    invalid.observations[0]!.factIds = ["unknown-fact"];
    return { response: JSON.stringify(invalid) };
  });
  const request = await requestFor(fixture.env);
  const response = await worker.fetch(request, fixture.env as never);
  const payload = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 503);
  assert.equal(payload.code, "AI_TEMPORARILY_UNAVAILABLE");
  assert.equal(responseCount, 2);
  assert.equal(fixture.kv.writes, 0);
});

test("KV read and write failures do not prevent safe validated AI output", async () => {
  const fixture = environment();
  fixture.kv.failRead = true;
  fixture.kv.failWrite = true;
  const response = await worker.fetch(await requestFor(fixture.env), fixture.env as never);
  const payload = await response.json() as Record<string, any>;
  assert.equal(response.status, 200);
  assert.equal(payload.status, "ok");
  assert.equal(fixture.aiCalls, 1);
  assert.equal(fixture.kv.reads, 1);
  assert.equal(fixture.kv.writes, 1);
});

test("Worker rejects extra request fields and mismatched cache scope", async () => {
  const fixture = environment();
  const extra = await worker.fetch(
    await requestFor(fixture.env, { bodyExtra: { userId: "someone-else" } }),
    fixture.env as never,
  );
  assert.equal(extra.status, 400);
  assert.equal(fixture.aiCalls, 0);

  const valid = await requestFor(fixture.env);
  const headers = new Headers(valid.headers);
  headers.set("x-study-insight-model", "different-model");
  const wrongModel = new Request(valid, { headers });
  const response = await worker.fetch(wrongModel, fixture.env as never);
  assert.equal(response.status, 400);
  assert.equal(fixture.kv.reads, 0);
  assert.equal(fixture.aiCalls, 0);
});