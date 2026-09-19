import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import test, { after, before, beforeEach } from "node:test";
import {
  createPersonalizationJsonParser,
  createPersonalizationRouter,
} from "../server/routes/personalization.js";
import {
  getPersonalizationFromCloud,
  putPersonalizationToCloud,
} from "../server/services/personalizationSync.js";
import type { PersonalizationCloudRecord } from "../shared/personalization.js";

const userA = "usr_api-user-a";
const userB = "usr_api-user-b";
const secret = "api-test-secret";

const config = {
  version: 2 as const,
  themeId: "ocean" as const,
  heroStyle: "aurora" as const,
  glassStyle: "frosted" as const,
  motionStyle: "subtle" as const,
  readingSize: "large" as const,
  home: {
    subjectOrder: ["SSC", "ImD", "PHC", "CA", "RM", "NT", "ID"] as const,
    hiddenSubjectIds: ["NT"] as const,
    semesterVisibility: { semester1: true, semester2: false },
  },
};

const record: PersonalizationCloudRecord = {
  recordVersion: 2,
  config,
  revision: "revision-a",
  updatedAt: "2026-09-19T00:00:00.000Z",
  lastIntentId: "pi_api-record",
};

type UpstreamMode =
  | "ok"
  | "empty"
  | "malformed"
  | "throttle"
  | "unavailable"
  | "internal-auth";

let mode: UpstreamMode = "ok";
let calls: Array<{ url: string; init?: RequestInit }> = [];
let server: http.Server;
let baseUrl = "";
let originalFetch: typeof fetch;
let originalEnabled: string | undefined;
let originalWorkerUrl: string | undefined;
let originalSyncSecret: string | undefined;

function upstreamResponse(): Response {
  if (mode === "ok") {
    return Response.json({ status: "ok", record });
  }
  if (mode === "empty") {
    return Response.json({ status: "empty", record: null });
  }
  if (mode === "malformed") {
    return Response.json({ status: "ok", record: { ...record, recordVersion: 99 } });
  }
  if (mode === "throttle") {
    return new Response(JSON.stringify({ error: "KV throttled" }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "5" },
    });
  }
  if (mode === "internal-auth") {
    return new Response(JSON.stringify({ error: "invalid secret" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  throw new Error("worker unavailable");
}

function authMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const authorization = req.get("authorization");
  const cookie = req.get("cookie");
  if (authorization === "Bearer user-a" || cookie === "auth_token=user-a") {
    (req as express.Request & { user?: { id: string } }).user = { id: userA };
    return next();
  }
  return res.status(401).json({ error: "Authentication required." });
}

function mutationMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }
  if (!req.get("X-Requested-With")) {
    return res.status(403).json({ error: "Forbidden: missing X-Requested-With header." });
  }
  const hasBearer = req.get("authorization")?.startsWith("Bearer ") === true;
  if (req.get("cookie") && !req.get("origin") && !req.get("referer") && !hasBearer) {
    return res.status(403).json({ error: "Forbidden: missing CSRF origin proof." });
  }
  if (req.get("origin") && req.get("origin") !== "https://app.invalid") {
    return res.status(403).json({ error: "Forbidden: invalid request origin." });
  }
  return next();
}

async function request(path: string, init: RequestInit = {}) {
  return originalFetch(`${baseUrl}${path}`, init);
}

async function jsonResponse(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

before(async () => {
  originalFetch = globalThis.fetch;
  originalEnabled = process.env.PERSONALIZATION_CLOUD_SYNC_ENABLED;
  originalWorkerUrl = process.env.PERSONALIZATION_WORKER_URL;
  originalSyncSecret = process.env.PERSONALIZATION_SYNC_SECRET;
  process.env.PERSONALIZATION_CLOUD_SYNC_ENABLED = "true";
  process.env.PERSONALIZATION_WORKER_URL = "https://worker.invalid";
  process.env.PERSONALIZATION_SYNC_SECRET = secret;
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return upstreamResponse();
  };

  const app = express();
  app.use("/api/personalization", createPersonalizationJsonParser());
  app.use("/api/personalization", mutationMiddleware);
  app.use(
    "/api/personalization",
    createPersonalizationRouter({
      requireUser: authMiddleware,
      isEnabled: () => process.env.PERSONALIZATION_CLOUD_SYNC_ENABLED === "true",
      getCloud: getPersonalizationFromCloud,
      putCloud: putPersonalizationToCloud,
    }),
  );
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unhandled error" });
  });

  server = await new Promise<http.Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  mode = "ok";
  calls = [];
  process.env.PERSONALIZATION_CLOUD_SYNC_ENABLED = "true";
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  globalThis.fetch = originalFetch;
  if (originalEnabled === undefined) delete process.env.PERSONALIZATION_CLOUD_SYNC_ENABLED;
  else process.env.PERSONALIZATION_CLOUD_SYNC_ENABLED = originalEnabled;
  if (originalWorkerUrl === undefined) delete process.env.PERSONALIZATION_WORKER_URL;
  else process.env.PERSONALIZATION_WORKER_URL = originalWorkerUrl;
  if (originalSyncSecret === undefined) delete process.env.PERSONALIZATION_SYNC_SECRET;
  else process.env.PERSONALIZATION_SYNC_SECRET = originalSyncSecret;
});

test("unauthenticated GET and PUT remain public 401s", async () => {
  assert.equal((await request("/api/personalization")).status, 401);
  assert.equal((await request("/api/personalization", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
    body: JSON.stringify({ config, intentId: "pi_unauth", knownRevision: null }),
  })).status, 401);
  assert.equal(calls.length, 0);
});

test("disabled authenticated GET and PUT do not call the Worker service", async () => {
  process.env.PERSONALIZATION_CLOUD_SYNC_ENABLED = "false";
  const headers = { Authorization: "Bearer user-a", "X-Requested-With": "fetch" };
  const get = await request("/api/personalization", { headers });
  assert.equal(get.status, 200);
  assert.deepEqual(await jsonResponse(get), { status: "disabled", record: null });

  const put = await request("/api/personalization", {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ config, intentId: "pi_disabled", knownRevision: null }),
  });
  assert.equal(put.status, 200);
  assert.deepEqual(await jsonResponse(put), { status: "disabled" });
  assert.equal(calls.length, 0);
});

test("authenticated GET maps a cloud record and passes req.user.id", async () => {
  const response = await request("/api/personalization?userId=" + userB, {
    headers: { Authorization: "Bearer user-a" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await jsonResponse(response), { status: "ok", record });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://worker.invalid/personalization/${encodeURIComponent(userA)}`);
});

test("authenticated GET maps an empty cloud result", async () => {
  mode = "empty";
  const response = await request("/api/personalization", {
    headers: { Authorization: "Bearer user-a" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await jsonResponse(response), { status: "empty", record: null });
});

test("authenticated PUT forwards validated config, intent, and User A identity", async () => {
  const response = await request("/api/personalization", {
    method: "PUT",
    headers: {
      Authorization: "Bearer user-a",
      "X-Requested-With": "fetch",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      config,
      intentId: "pi_valid-permutation",
      knownRevision: "revision-context",
    }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await jsonResponse(response), { status: "ok", record });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://worker.invalid/personalization/${encodeURIComponent(userA)}`);
  const forwarded = JSON.parse(String(calls[0].init?.body));
  assert.deepEqual(forwarded, {
    config,
    intentId: "pi_valid-permutation",
    knownRevision: "revision-context",
  });
});

test("client userId injection and query identity cannot target User B", async () => {
  const response = await request("/api/personalization?userId=" + userB, {
    method: "PUT",
    headers: {
      Authorization: "Bearer user-a",
      "X-Requested-With": "fetch",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId: userB,
      config,
      intentId: "pi_userid-attack",
      knownRevision: null,
    }),
  });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("invalid config, version, and Home order fail before Worker calls", async () => {
  const invalidBodies = [
    { config: { ...config, themeId: "not-a-theme" }, intentId: "pi_invalid-enum", knownRevision: null },
    { config: { ...config, version: 1 }, intentId: "pi_invalid-version", knownRevision: null },
    { config: { ...config, home: { subjectOrder: ["SSC", "SSC", "PHC", "CA", "RM", "NT", "ID"] } }, intentId: "pi_duplicate", knownRevision: null },
    { config: { ...config, home: { subjectOrder: ["SSC", "ImD", "PHC"] } }, intentId: "pi_missing", knownRevision: null },
    { config: { ...config, home: { subjectOrder: ["SSC", "ImD", "PHC", "CA", "RM", "NT", "XX"] } }, intentId: "pi_unknown", knownRevision: null },
  ];
  for (const body of invalidBodies) {
    const response = await request("/api/personalization", {
      method: "PUT",
      headers: {
        Authorization: "Bearer user-a",
        "X-Requested-With": "fetch",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
  }
  assert.equal(calls.length, 0);
});

test("invalid intentId, knownRevision, and unknown fields fail before Worker calls", async () => {
  const bodies = [
    { config, intentId: "", knownRevision: null },
    { config, intentId: "bad space", knownRevision: null },
    { config, intentId: "pi_valid-revision", knownRevision: "r".repeat(257) },
    { config, intentId: "pi_unknown-field", knownRevision: null, extra: true },
  ];
  for (const body of bodies) {
    const response = await request("/api/personalization", {
      method: "PUT",
      headers: {
        Authorization: "Bearer user-a",
        "X-Requested-With": "fetch",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
  }
  assert.equal(calls.length, 0);
});

test("semantic config payloads over 16 KiB fail before Worker calls", async () => {
  const response = await request("/api/personalization", {
    method: "PUT",
    headers: {
      Authorization: "Bearer user-a",
      "X-Requested-With": "fetch",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      config: { ...config, home: { ...config.home, extra: "x".repeat(17_000) } },
      intentId: "pi_oversized-config",
      knownRevision: null,
    }),
  });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("actual request bytes over 32 KiB return 413 before Worker calls", async () => {
  const body = `${" ".repeat(33_000)}${JSON.stringify({
    config,
    intentId: "pi_oversized-http",
    knownRevision: null,
  })}`;
  const response = await request("/api/personalization", {
    method: "PUT",
    headers: {
      Authorization: "Bearer user-a",
      "X-Requested-With": "fetch",
      "Content-Type": "application/json",
    },
    body,
  });
  assert.ok(new TextEncoder().encode(body).byteLength > 32_768);
  assert.equal(response.status, 413);
  assert.equal(calls.length, 0);
});

test("Worker 429 mapping forwards Retry-After", async () => {
  mode = "throttle";
  const response = await request("/api/personalization", {
    method: "PUT",
    headers: {
      Authorization: "Bearer user-a",
      "X-Requested-With": "fetch",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ config, intentId: "pi_throttle", knownRevision: null }),
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "5");
  assert.deepEqual(await jsonResponse(response), { error: "KV throttled", retryable: true });
});

test("Worker malformed response maps to controlled 502", async () => {
  mode = "malformed";
  const response = await request("/api/personalization", {
    headers: { Authorization: "Bearer user-a" },
  });
  assert.equal(response.status, 502);
  assert.deepEqual(await jsonResponse(response), {
    error: "Personalization sync returned an invalid record.",
    retryable: false,
  });
});

test("Worker unavailability maps to retryable 503", async () => {
  mode = "unavailable";
  const response = await request("/api/personalization", {
    headers: { Authorization: "Bearer user-a" },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await jsonResponse(response), {
    error: "Personalization sync is unavailable.",
    retryable: true,
  });
});

test("Worker internal 401 maps to upstream 503, not public session 401", async () => {
  mode = "internal-auth";
  const response = await request("/api/personalization", {
    headers: { Authorization: "Bearer user-a" },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await jsonResponse(response), {
    error: "Personalization sync is unavailable.",
    retryable: true,
  });
});

test("cookie mutation protection rejects missing proof and accepts protected cookie PUT", async () => {
  const cookieHeaders = {
    Cookie: "auth_token=user-a",
    "Content-Type": "application/json",
  };
  const missingHeader = await request("/api/personalization", {
    method: "PUT",
    headers: cookieHeaders,
    body: JSON.stringify({ config, intentId: "pi_cookie-no-header", knownRevision: null }),
  });
  assert.equal(missingHeader.status, 403);

  const missingOrigin = await request("/api/personalization", {
    method: "PUT",
    headers: { ...cookieHeaders, "X-Requested-With": "fetch" },
    body: JSON.stringify({ config, intentId: "pi_cookie-no-origin", knownRevision: null }),
  });
  assert.equal(missingOrigin.status, 403);

  const protectedRequest = await request("/api/personalization", {
    method: "PUT",
    headers: {
      ...cookieHeaders,
      "X-Requested-With": "fetch",
      Origin: "https://app.invalid",
    },
    body: JSON.stringify({ config, intentId: "pi_cookie-valid", knownRevision: null }),
  });
  assert.equal(protectedRequest.status, 200);
  assert.equal(calls.length, 1);
});

test("bearer/native mutation remains compatible with the mutation header", async () => {
  const response = await request("/api/personalization", {
    method: "PUT",
    headers: {
      Authorization: "Bearer user-a",
      "X-Requested-With": "fetch",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ config, intentId: "pi_bearer-valid", knownRevision: null }),
  });
  assert.equal(response.status, 200);
});