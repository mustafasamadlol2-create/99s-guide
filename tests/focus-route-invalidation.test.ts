import assert from "node:assert/strict";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createFocusRouter } from "../server/routes/focus.js";

test("Focus broadcasts invalidation only after a successful mutation to the authenticated user", async () => {
  const invalidatedUsers: string[] = [];
  const requireUser: RequestHandler = (req, _res, next) => {
    (req as express.Request & { user: { id: string } }).user = {
      id: req.get("x-test-user") ?? "default-user",
    };
    next();
  };
  const service = {
    pauseSession: async (userId: string, sessionId: string) => ({
      userId,
      sessionId,
    }),
  };
  const app = express();
  app.use(express.json());
  app.use("/api/focus", createFocusRouter({
    requireUser,
    service: service as never,
    broadcastInvalidation: (userId) => invalidatedUsers.push(userId),
  }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}/api/focus/sessions/11111111-1111-4111-8111-111111111111/pause`;

  try {
    const invalidResponse = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-user": "user-a",
      },
      body: JSON.stringify({ idempotencyKey: "x", source: "web" }),
    });
    assert.equal(invalidResponse.status, 400);
    await invalidResponse.text();
    assert.deepEqual(invalidatedUsers, []);

    const successResponse = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-user": "user-a",
      },
      body: JSON.stringify({ idempotencyKey: "focus-test-key", source: "web" }),
    });
    assert.equal(successResponse.status, 200);
    assert.deepEqual(await successResponse.json(), {
      userId: "user-a",
      sessionId: "11111111-1111-4111-8111-111111111111",
    });
    assert.deepEqual(invalidatedUsers, ["user-a"]);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
