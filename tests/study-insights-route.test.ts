import assert from "node:assert/strict";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createStudyInsightsRouter } from "../server/routes/studyInsights.js";
import type { StudyInsightResponse } from "../server/features/study-insights/types.js";

function authenticatedAs(userId: string): RequestHandler {
  return (req, _res, next) => {
    (req as express.Request & { user?: { id: string } }).user = { id: userId };
    next();
  };
}

function createApp(options: {
  userId?: string;
  enabled?: boolean;
  generate?: (input: { userId: string; locale: "ar" | "en" }) => Promise<StudyInsightResponse>;
} = {}) {
  const app = express();
  app.use(express.json());
  app.use("/api/me/study-insights", createStudyInsightsRouter({
    requireUser: options.userId ? authenticatedAs(options.userId) : (_req, res) => res.status(401).json({ error: "Unauthorized" }),
    isEnabled: () => options.enabled ?? true,
    ...(options.generate ? { generate: options.generate } : {}),
  }));
  return app;
}

async function listen(app: express.Express): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port.");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

test("GET route is authenticated, locale-bounded, owner-scoped, and private", async () => {
  const calls: Array<{ userId: string; locale: string }> = [];
  const app = createApp({
    userId: "authenticated-student",
    generate: async (input) => {
      calls.push(input);
      return { status: "AI_UNAVAILABLE" } as StudyInsightResponse;
    },
  });
  const server = await listen(app);
  try {
    const response = await fetch(`${server.baseUrl}/api/me/study-insights?locale=ar`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(response.headers.get("vary") ?? "", /Authorization/u);
    assert.deepEqual(calls, [{ userId: "authenticated-student", locale: "ar" }]);

    const impersonation = await fetch(
      `${server.baseUrl}/api/me/study-insights?locale=en&userId=other-student`,
    );
    assert.equal(impersonation.status, 400);
    assert.equal(calls.length, 1);

    const invalidLocale = await fetch(`${server.baseUrl}/api/me/study-insights?locale=fr`);
    assert.equal(invalidLocale.status, 400);
    const unsupportedRefresh = await fetch(`${server.baseUrl}/api/me/study-insights?refresh=true`);
    assert.equal(unsupportedRefresh.status, 400);
  } finally {
    await server.close();
  }
});

test("disabled and unauthenticated requests never generate insights", async () => {
  let calls = 0;
  const disabledServer = await listen(createApp({
    userId: "disabled-student",
    enabled: false,
    generate: async () => {
      calls += 1;
      return { status: "AI_UNAVAILABLE" } as StudyInsightResponse;
    },
  }));
  try {
    const response = await fetch(`${disabledServer.baseUrl}/api/me/study-insights`);
    assert.equal(response.status, 404);
    assert.equal(calls, 0);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  } finally {
    await disabledServer.close();
  }

  const anonymousServer = await listen(createApp());
  try {
    const response = await fetch(`${anonymousServer.baseUrl}/api/me/study-insights`);
    assert.equal(response.status, 401);
    assert.equal(calls, 0);
  } finally {
    await anonymousServer.close();
  }
});

test("all authenticated requests, including cache hits, share a ten-per-hour limit", async () => {
  let calls = 0;
  const app = createApp({
    userId: "rate-limit-study-insight-user",
    generate: async () => {
      calls += 1;
      return { status: "AI_UNAVAILABLE" } as StudyInsightResponse;
    },
  });
  const server = await listen(app);
  try {
    const statuses: number[] = [];
    for (let index = 0; index < 11; index += 1) {
      const response = await fetch(`${server.baseUrl}/api/me/study-insights`);
      statuses.push(response.status);
    }
    assert.deepEqual(statuses.slice(0, 10), Array.from({ length: 10 }, () => 200));
    assert.equal(statuses[10], 429);
    assert.equal(calls, 10);
  } finally {
    await server.close();
  }
});