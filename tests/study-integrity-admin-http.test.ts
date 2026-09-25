import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import test from "node:test";
import {
  createAdminStudyIntegrityJsonParser,
  createAdminStudyIntegrityRouter,
} from "../server/routes/adminStudyIntegrity.js";
import type { StudyIntegrityService } from "../server/features/study-integrity/persistence/index.js";

type TestServer = {
  server: Server;
  baseUrl: string;
  calls: Array<{ method: string; input: unknown }>;
  close(): Promise<void>;
};

async function createTestServer(): Promise<TestServer> {
  const calls: TestServer["calls"] = [];
  const safeSignal = {
    id: "ae2c9c4c-019e-45cf-99b9-a9a1819b6520",
    userId: "subject-1",
    actionType: "mcq.answer",
    observationCode: "IDEMPOTENCY_CONFLICT",
    category: "IDEMPOTENCY",
    severity: "BLOCK",
    ruleId: "integrity.idempotency.conflict.v1",
    ruleVersion: "study-integrity-v1",
    evidenceClass: "UNVERIFIED_CLIENT",
    source: "web",
    privacyClass: "ADMIN_SECURITY",
    resourceKind: null,
    resourceId: null,
    firstOccurredAt: new Date("2026-09-25T10:00:00.000Z"),
    lastOccurredAt: new Date("2026-09-25T10:00:00.000Z"),
    lastReceivedAt: new Date("2026-09-25T10:00:00.000Z"),
    occurrenceCount: 1,
    status: "OPEN",
    reviewVersion: 0,
    latestSafeDetails: { actionType: "mcq.answer" },
    createdAt: new Date("2026-09-25T10:00:00.000Z"),
    updatedAt: new Date("2026-09-25T10:00:00.000Z"),
    resolvedAt: null,
  };
  const service = {
    async listSignals(input: unknown) {
      calls.push({ method: "listSignals", input });
      return { items: [safeSignal], nextCursor: null };
    },
    async getSignalDetail(signalId: string) {
      calls.push({ method: "getSignalDetail", input: signalId });
      return {
        signal: safeSignal,
        reviewHistory: [{
          id: "11d49a4d-4940-4bc4-928f-f31d84b89cfe",
          signalId,
          reviewerUserId: "reviewer-1",
          fromStatus: "OPEN",
          toStatus: "ACKNOWLEDGED",
          actionType: "ACKNOWLEDGE",
          note: "Reviewed technical context.",
          createdAt: new Date("2026-09-25T10:00:00.000Z"),
        }],
      };
    },
    async reviewSignal(input: unknown) {
      calls.push({ method: "reviewSignal", input });
      return {
        signal: { ...safeSignal, status: "ACKNOWLEDGED", reviewVersion: 1 },
        reviewAction: {
          id: "11d49a4d-4940-4bc4-928f-f31d84b89cfe",
          signalId: safeSignal.id,
          reviewerUserId: "admin-1",
          fromStatus: "OPEN",
          toStatus: "ACKNOWLEDGED",
          actionType: "ACKNOWLEDGE",
          note: null,
          createdAt: new Date("2026-09-25T10:00:00.000Z"),
        },
      };
    },
  } as unknown as StudyIntegrityService;

  const requireAdmin: RequestHandler = (req, res, next) => {
    const role = req.headers["x-test-role"];
    if (!role) return res.status(401).json({ error: "Authentication required." });
    if (role !== "admin" && role !== "owner") {
      return res.status(403).json({ error: "Administrative role required." });
    }
    (req as express.Request & { user?: { id: string; role: string } }).user = {
      id: "admin-1",
      role,
    };
    next();
  };
  const app = express();
  app.use("/api/admin/study-integrity", createAdminStudyIntegrityJsonParser());
  app.use(express.json({ limit: "20mb" }));
  app.use(
    "/api/admin/study-integrity",
    createAdminStudyIntegrityRouter({ requireAdmin, service }),
  );
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve()),
      );
    },
  };
}

async function withServer(run: (server: TestServer) => Promise<void>) {
  const server = await createTestServer();
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

test("admin signal routes require owner/admin authorization and bound list filters", async () => {
  await withServer(async ({ baseUrl, calls }) => {
    const unauthenticated = await fetch(`${baseUrl}/api/admin/study-integrity/signals`);
    assert.equal(unauthenticated.status, 401);
    const student = await fetch(`${baseUrl}/api/admin/study-integrity/signals`, {
      headers: { "x-test-role": "student" },
    });
    assert.equal(student.status, 403);
    assert.equal(calls.length, 0);

    const admin = await fetch(`${baseUrl}/api/admin/study-integrity/signals?limit=25&severity=BLOCK`, {
      headers: { "x-test-role": "admin" },
    });
    assert.equal(admin.status, 200);
    assert.equal(admin.headers.get("cache-control"), "no-store, private");
    assert.deepEqual(calls[0], {
      method: "listSignals",
      input: {
        status: "OPEN",
        includeAllStatuses: false,
        severity: "BLOCK",
        limit: 25,
      },
    });

    const invalid = await fetch(`${baseUrl}/api/admin/study-integrity/signals?limit=101`, {
      headers: { "x-test-role": "owner" },
    });
    assert.equal(invalid.status, 400);
    assert.equal(calls.length, 1);
  });
});

test("admin list windows are bounded when only one endpoint is supplied", async () => {
  await withServer(async ({ baseUrl, calls }) => {
    const from = new Date(Date.now() - 60 * 60 * 1000);
    const response = await fetch(
      `${baseUrl}/api/admin/study-integrity/signals?from=${encodeURIComponent(from.toISOString())}`,
      { headers: { "x-test-role": "admin" } },
    );
    assert.equal(response.status, 200);
    const input = calls[0]?.input as { from?: Date; to?: Date };
    assert.equal(input.from?.getTime(), from.getTime());
    assert.ok(input.to instanceof Date);
    assert.ok(input.to.getTime() >= from.getTime());
    assert.ok(input.to.getTime() - from.getTime() <= 90 * 24 * 60 * 60 * 1000);

    const tooOld = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    const rejected = await fetch(
      `${baseUrl}/api/admin/study-integrity/signals?from=${encodeURIComponent(tooOld.toISOString())}`,
      { headers: { "x-test-role": "admin" } },
    );
    assert.equal(rejected.status, 400);
    assert.equal(calls.length, 1);
  });
});

test("review route derives reviewer identity from authenticated context", async () => {
  await withServer(async ({ baseUrl, calls }) => {
    const response = await fetch(
      `${baseUrl}/api/admin/study-integrity/signals/ae2c9c4c-019e-45cf-99b9-a9a1819b6520/review`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-role": "owner",
        },
        body: JSON.stringify({
          action: "ACKNOWLEDGE",
          expectedReviewVersion: 0,
          note: "  reviewed  ",
        }),
      },
    );
    assert.equal(response.status, 200);
    assert.equal(calls[0]?.method, "reviewSignal");
    assert.deepEqual(calls[0]?.input, {
      signalId: "ae2c9c4c-019e-45cf-99b9-a9a1819b6520",
      reviewerUserId: "admin-1",
      action: "ACKNOWLEDGE",
      expectedReviewVersion: 0,
      note: "  reviewed  ",
    });

    const forgedReviewer = await fetch(
      `${baseUrl}/api/admin/study-integrity/signals/ae2c9c4c-019e-45cf-99b9-a9a1819b6520/review`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-role": "admin",
        },
        body: JSON.stringify({
          action: "DISMISS",
          expectedReviewVersion: 0,
          reviewerUserId: "forged-user",
        }),
      },
    );
    assert.equal(forgedReviewer.status, 400);
    assert.equal(calls.length, 1);
  });
});

test("detail responses contain only the signal, safe details, and review history", async () => {
  await withServer(async ({ baseUrl, calls }) => {
    const response = await fetch(
      `${baseUrl}/api/admin/study-integrity/signals/ae2c9c4c-019e-45cf-99b9-a9a1819b6520`,
      { headers: { "x-test-role": "admin" } },
    );
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["reviewHistory", "signal"]);
    assert.equal(calls[0]?.method, "getSignalDetail");

    const studentPath = await fetch(`${baseUrl}/api/me/integrity`, {
      headers: { "x-test-role": "student" },
    });
    assert.equal(studentPath.status, 404);
  });
});

test("admin review parser rejects oversized and HTML note requests", async () => {
  await withServer(async ({ baseUrl }) => {
    const oversized = await fetch(
      `${baseUrl}/api/admin/study-integrity/signals/ae2c9c4c-019e-45cf-99b9-a9a1819b6520/review`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-role": "admin",
        },
        body: JSON.stringify({ note: "x".repeat(20_000) }),
      },
    );
    assert.equal(oversized.status, 413);

    const html = await fetch(
      `${baseUrl}/api/admin/study-integrity/signals/ae2c9c4c-019e-45cf-99b9-a9a1819b6520/review`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-role": "admin",
        },
        body: JSON.stringify({
          action: "ADD_NOTE",
          expectedReviewVersion: 0,
          note: "<script>private</script>",
        }),
      },
    );
    assert.equal(html.status, 400);
  });
});