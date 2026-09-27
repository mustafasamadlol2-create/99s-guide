import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createStudyAnalyzerRouter } from "../server/routes/studyAnalyzer.js";
import type { StudyAnalyzerDto } from "../server/features/study-analyzer/types.js";

const fakeDto = { analyzerVersion: "study-analyzer-v1" } as StudyAnalyzerDto;

async function withServer(
  app: express.Express,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
}

function authenticatedAs(userId: string): RequestHandler {
  return (req, _res, next) => {
    (req as express.Request & { user?: { id: string } }).user = { id: userId };
    next();
  };
}

test("GET returns only the authenticated user's private DTO with no-store headers", async () => {
  const receivedUserIds: string[] = [];
  const app = express();
  app.use(createStudyAnalyzerRouter({
    requireUser: authenticatedAs("self-user"),
    isEnabled: () => true,
    readAnalyzer: async (userId) => {
      receivedUserIds.push(userId);
      return fakeDto;
    },
  }));

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.match(response.headers.get("vary") ?? "", /authorization/i);
    assert.deepEqual(await response.json(), fakeDto);
    assert.deepEqual(receivedUserIds, ["self-user"]);
  });
});

test("request parameters cannot override identity or select a different window", async () => {
  let calls = 0;
  const app = express();
  app.use(createStudyAnalyzerRouter({
    requireUser: authenticatedAs("self-user"),
    isEnabled: () => true,
    readAnalyzer: async () => {
      calls += 1;
      return fakeDto;
    },
  }));

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/?userId=other-user&window=CURRENT_SEMESTER`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Study Analyzer does not accept request parameters.",
    });
    assert.equal(calls, 0);
  });
});

test("disabled feature and missing authenticated identity never call the reader", async () => {
  let calls = 0;
  const disabled = express();
  disabled.use(createStudyAnalyzerRouter({
    requireUser: authenticatedAs("self-user"),
    isEnabled: () => false,
    readAnalyzer: async () => {
      calls += 1;
      return fakeDto;
    },
  }));
  const unauthenticated = express();
  unauthenticated.use(createStudyAnalyzerRouter({
    requireUser: (_req, _res, next) => next(),
    isEnabled: () => true,
    readAnalyzer: async () => {
      calls += 1;
      return fakeDto;
    },
  }));

  await withServer(disabled, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 404);
  });
  await withServer(unauthenticated, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 401);
  });
  assert.equal(calls, 0);
});