import assert from "node:assert/strict";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createAskStudyDataRouter } from "../server/routes/askStudyData.js";
import type { AskMyStudyDataResponse } from "../server/features/ask-study-data/types.js";

function authenticatedAs(user: {
  id: string;
  role?: string;
  preferences?: unknown;
}): RequestHandler {
  return (req, _res, next) => {
    (req as express.Request & { user?: typeof user }).user = user;
    next();
  };
}

function response(): AskMyStudyDataResponse {
  return {
    status: "ANSWERED",
    source: "DETERMINISTIC",
    intent: "ACTIVITY_SUMMARY",
    locale: "en",
    answer: "You had 8 active study days.",
    evidence: [{ factIds: ["activity.active_days.30d"] }],
    limitations: [],
    asOf: "2026-09-27T10:00:00.000Z",
    routerVersion: "ask-study-data-router-v1",
    window: "LAST_30_DAYS",
  };
}

function createApp(options: {
  user?: { id: string; role?: string; preferences?: unknown };
  enabled?: boolean;
  ask?: (input: { userId: string; question: string; locale: "ar" | "en" }) => Promise<AskMyStudyDataResponse>;
} = {}) {
  const app = express();
  app.use("/api/me/study-data/ask", (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "Authorization, Cookie");
    next();
  });
  app.use("/api/me/study-data/ask", express.json({ limit: "16kb" }));
  app.use(express.json());
  app.use("/api/me/study-data/ask", createAskStudyDataRouter({
    requireUser: options.user
      ? authenticatedAs(options.user)
      : (_req, res) => res.status(401).json({ error: "Unauthorized" }),
    isEnabled: () => options.enabled ?? true,
    ...(options.ask ? { ask: options.ask } : {}),
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
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

test("POST is private, authenticated, strict, and uses the authenticated student's locale preference", async () => {
  const calls: Array<{ userId: string; question: string; locale: string }> = [];
  const server = await listen(createApp({
    user: { id: "student-42", preferences: { language: "ar" } },
    ask: async (input) => {
      calls.push(input);
      return response();
    },
  }));
  try {
    const answered = await fetch(`${server.baseUrl}/api/me/study-data/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: " كم يوم درست هذا الشهر؟ " }),
    });
    assert.equal(answered.status, 200);
    assert.equal(answered.headers.get("cache-control"), "private, no-store");
    assert.match(answered.headers.get("vary") ?? "", /Authorization/u);
    assert.deepEqual(calls, [{
      userId: "student-42",
      question: "كم يوم درست هذا الشهر؟",
      locale: "ar",
    }]);

    const impersonation = await fetch(`${server.baseUrl}/api/me/study-data/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "How many days?", userId: "other-student" }),
    });
    assert.equal(impersonation.status, 400);
    assert.equal(calls.length, 1);

    const invalidLocale = await fetch(`${server.baseUrl}/api/me/study-data/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "How many days?", locale: "fr" }),
    });
    assert.equal(invalidLocale.status, 400);
    assert.equal(calls.length, 1);
  } finally {
    await server.close();
  }
});

test("feature-off, unauthenticated, and privileged users cannot invoke data retrieval", async () => {
  let calls = 0;
  const ask = async () => {
    calls += 1;
    return response();
  };
  const disabled = await listen(createApp({
    user: { id: "student-off" },
    enabled: false,
    ask,
  }));
  try {
    const result = await fetch(`${disabled.baseUrl}/api/me/study-data/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "How many days?" }),
    });
    assert.equal(result.status, 404);
    assert.equal(result.headers.get("cache-control"), "private, no-store");
  } finally {
    await disabled.close();
  }

  const anonymous = await listen(createApp({ ask }));
  try {
    const result = await fetch(`${anonymous.baseUrl}/api/me/study-data/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "How many days?" }),
    });
    assert.equal(result.status, 401);
  } finally {
    await anonymous.close();
  }

  const admin = await listen(createApp({ user: { id: "admin-1", role: "admin" }, ask }));
  try {
    const result = await fetch(`${admin.baseUrl}/api/me/study-data/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "How many days?" }),
    });
    assert.equal(result.status, 403);
  } finally {
    await admin.close();
  }
  assert.equal(calls, 0);
});

test("one authenticated user is limited to 20 questions per hour", async () => {
  let calls = 0;
  const server = await listen(createApp({
    user: { id: "rate-limited-student" },
    ask: async () => {
      calls += 1;
      return response();
    },
  }));
  try {
    const statuses: number[] = [];
    for (let index = 0; index < 21; index += 1) {
      const result = await fetch(`${server.baseUrl}/api/me/study-data/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "How many days?" }),
      });
      statuses.push(result.status);
    }
    assert.deepEqual(statuses.slice(0, 20), Array.from({ length: 20 }, () => 200));
    assert.equal(statuses[20], 429);
    assert.equal(calls, 20);
  } finally {
    await server.close();
  }
});

test("malformed and oversized JSON errors remain private and no-store", async () => {
  const server = await listen(createApp({ user: { id: "student-1" } }));
  try {
    const malformed = await fetch(`${server.baseUrl}/api/me/study-data/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.headers.get("cache-control"), "private, no-store");

    const oversized = await fetch(`${server.baseUrl}/api/me/study-data/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "x".repeat(17 * 1024) }),
    });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.headers.get("cache-control"), "private, no-store");
  } finally {
    await server.close();
  }
});