import test from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCalendarImportRouter } from "../server/services/calendarImport/router.js";
import type { CalendarImportService } from "../server/services/calendarImport/service.js";

type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
};

function makeTestService() {
  let calendarWrites = 0;
  const candidate = {
    candidateId: "candidate-1",
    title: "Imported lecture",
    eventType: "LECTURE",
    date: "2026-09-20",
    startTime: "08:00",
    endTime: "09:00",
    allDay: false,
    rawDate: "20 September 2026",
    rawStartTime: "8:00",
    rawEndTime: "9:00",
    subjectId: "ID",
    subjectLabelRaw: "Infectious Diseases",
    room: null,
    doctor: null,
    description: null,
    targetGroups: ["A"],
    sourcePage: 1,
    sourceImageIndex: null,
    sourceEvidence: "Imported lecture",
    warnings: [],
    verification: { status: "SOURCE_MATCH", issues: [] },
    status: "VERIFIED",
    selected: true,
  };
  const job = {
    id: "job-1",
    status: "READY_FOR_REVIEW",
    stage: "Ready for review",
    sourceFileName: "schedule.pdf",
    sourceMime: "application/pdf",
    sourcePageCount: 1,
    timezone: "Asia/Baghdad",
    defaultTargetGroups: ["A"],
    progressCurrent: 1,
    progressTotal: 1,
    preview: {
      candidates: [candidate],
      warnings: [],
      provider: { provider: "test", model: "test" },
    },
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };
  const service = {
    start: async () => job,
    get: async (userId: string, id: string) => userId === "admin-a" && id === "job-1" ? job : null,
    updateReview: async (_userId: string, _id: string, value: unknown) => {
      if (!value || typeof value !== "object" || !Array.isArray((value as { candidates?: unknown }).candidates)) {
        throw new Error("Review candidates are invalid.");
      }
      return job;
    },
    commit: async (_userId: string, _id: string, value: unknown) => {
      const ids = (value as { candidateIds?: unknown }).candidateIds;
      if (!Array.isArray(ids) || ids.length !== 1 || ids[0] !== "candidate-1") {
        throw new Error("Invalid candidate selection.");
      }
      calendarWrites += 1;
      return {
        inserted: 1,
        alreadyImported: 0,
        duplicatesSkipped: 0,
        conflictsSkipped: 0,
        invalidRejected: 0,
        events: [{ id: "event-1", allDay: false }],
      };
    },
    cancel: async (userId: string, id: string) => userId === "admin-a" && id === "job-1",
    recoverStaleJobs: async () => {},
  } as unknown as CalendarImportService;
  return { service, getCalendarWrites: () => calendarWrites };
}

async function withServer(
  service: CalendarImportService,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  const requireAdmin: RequestHandler = (req, res, next) => {
    const authorization = req.header("authorization");
    if (!authorization) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    const userId = authorization === "Bearer admin-a" ? "admin-a"
      : authorization === "Bearer admin-b" ? "admin-b"
        : "student-a";
    if (userId === "student-a") {
      res.status(403).json({ error: "Administrator access required." });
      return;
    }
    (req as express.Request & { user: { id: string } }).user = { id: userId };
    next();
  };
  const root = await mkdtemp(join(tmpdir(), "calendar-import-http-"));
  app.use("/api/admin/calendar/import", createCalendarImportRouter({
    service,
    requireAdmin,
    sourceRoot: root,
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
}

async function request(baseUrl: string, path: string, options: RequestOptions = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body,
  });
}

test("calendar import HTTP routes enforce admin access and safe job ownership", async () => {
  const { service } = makeTestService();
  await withServer(service, async (baseUrl) => {
    assert.equal((await request(baseUrl, "/api/admin/calendar/import/job-1")).status, 401);
    assert.equal((await request(baseUrl, "/api/admin/calendar/import/job-1", {
      headers: { authorization: "Bearer student-a" },
    })).status, 403);
    assert.equal((await request(baseUrl, "/api/admin/calendar/import/no-such-job", {
      headers: { authorization: "Bearer admin-a" },
    })).status, 404);
    assert.equal((await request(baseUrl, "/api/admin/calendar/import/job-1", {
      headers: { authorization: "Bearer admin-b" },
    })).status, 404);
  });
});

test("calendar import HTTP start response is a public DTO without sourcePath", async () => {
  const { service } = makeTestService();
  await withServer(service, async (baseUrl) => {
    const form = new FormData();
    form.append("defaultTargetGroups", JSON.stringify(["A"]));
    form.append("files", new Blob(["not used by the mocked service"], { type: "image/png" }), "schedule.png");
    const response = await request(baseUrl, "/api/admin/calendar/import", {
      method: "POST",
      headers: { authorization: "Bearer admin-a" },
      body: form,
    });
    assert.equal(response.status, 202);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.id, "job-1");
    assert.equal("sourcePath" in body, false);
    assert.equal("providerInternals" in body, false);
  });
});

test("calendar import HTTP preview performs no Calendar writes and commit writes through the boundary", async () => {
  const state = makeTestService();
  await withServer(state.service, async (baseUrl) => {
    const preview = await request(baseUrl, "/api/admin/calendar/import/job-1", {
      headers: { authorization: "Bearer admin-a" },
    });
    assert.equal(preview.status, 200);
    assert.equal(state.getCalendarWrites(), 0);

    const commit = await request(baseUrl, "/api/admin/calendar/import/job-1/commit", {
      method: "POST",
      headers: {
        authorization: "Bearer admin-a",
        "content-type": "application/json",
      },
      body: JSON.stringify({ candidateIds: ["candidate-1"], allowConflicts: true }),
    });
    assert.equal(commit.status, 200);
    assert.equal(state.getCalendarWrites(), 1);
    assert.equal((await commit.json()).inserted, 1);
  });
});

test("calendar import HTTP review rejects malformed payloads and cancel is scoped", async () => {
  const { service } = makeTestService();
  await withServer(service, async (baseUrl) => {
    const review = await request(baseUrl, "/api/admin/calendar/import/job-1/review", {
      method: "PATCH",
      headers: {
        authorization: "Bearer admin-a",
        "content-type": "application/json",
      },
      body: JSON.stringify({ candidates: "not-an-array" }),
    });
    assert.equal(review.status, 400);

    const forbiddenCancel = await request(baseUrl, "/api/admin/calendar/import/job-1/cancel", {
      method: "POST",
      headers: { authorization: "Bearer admin-b" },
    });
    assert.equal(forbiddenCancel.status, 404);

    const cancel = await request(baseUrl, "/api/admin/calendar/import/job-1/cancel", {
      method: "POST",
      headers: { authorization: "Bearer admin-a" },
    });
    assert.equal(cancel.status, 204);
  });
});