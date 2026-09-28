import assert from "node:assert/strict";
import test from "node:test";
import { createFocusApi, FocusApiError, type FocusApiRequestOptions } from "../src/features/focus/api/focusApi.ts";

const id = "00000000-0000-4000-8000-000000000001";
const itemId = "00000000-0000-4000-8000-000000000002";
const lectureId = "00000000-0000-4000-8000-000000000003";
const planId = "00000000-0000-4000-8000-000000000004";
const now = "2025-01-01T00:00:00.000Z";

function session(status = "ACTIVE") {
  return {
    id, planId: id, planItemId: itemId, lectureId, status,
    startedAt: now, plannedEndAt: now, actualEndedAt: null, lastCheckpointAt: now,
    activeSeconds: 0, pauseSeconds: 0, serverNow: now, elapsedActiveSeconds: 0,
    remainingSeconds: 2700, completionEligible: false, sessionNumber: 1,
    plannedSessionCount: 1, isLastPlannedSession: true, reconciliationRequired: false,
    completionReason: null,
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("Focus session API sends canonical routes, bodies, and request policy", async () => {
  const calls: Array<{ path: string; options: FocusApiRequestOptions }> = [];
  const api = createFocusApi(async (path, options = {}) => {
    calls.push({ path: String(path), options });
    if (String(path).endsWith("/current")) return response({ session: null, serverNow: now });
    return response({ session: session(), idempotency: "FIRST_SEEN" });
  });

  await api.getCurrentFocusSession();
  await api.startFocusSession({ planId: id, planItemId: itemId, idempotencyKey: "start-key", source: "web" });
  await api.pauseFocusSession(id, { idempotencyKey: "pause-key", source: "pwa" });
  await api.completeFocusSession(id, { idempotencyKey: "complete-key" });

  assert.deepEqual(calls.map((call) => call.path), [
    "/api/focus/sessions/current",
    "/api/focus/sessions/start",
    `/api/focus/sessions/${id}/pause`,
    `/api/focus/sessions/${id}/complete`,
  ]);
  assert.equal(calls.every((call) => call.options.bypassCache === true && call.options.retries === 0 && call.options.timeoutMs === 15_000), true);
  assert.equal(typeof calls[0].options.requestKey, "string");
  assert.deepEqual(JSON.parse(String(calls[1].options.body)), {
    planId: id, planItemId: itemId, idempotencyKey: "start-key", source: "web",
  });
  assert.deepEqual(JSON.parse(String(calls[3].options.body)), { idempotencyKey: "complete-key" });
});

test("current-session request keys are unique across API instances", async () => {
  const keys: string[] = [];
  const request = async (_path: RequestInfo | URL, options: FocusApiRequestOptions = {}) => {
    keys.push(String(options.requestKey));
    return response({ session: null, serverNow: now });
  };
  const firstApi = createFocusApi(request);
  const secondApi = createFocusApi(request);

  await Promise.all([
    firstApi.getCurrentFocusSession(),
    secondApi.getCurrentFocusSession(),
  ]);

  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
});

test("Focus plan methods validate envelopes and only send allowed fields", async () => {
  const calls: Array<{ path: string; options: FocusApiRequestOptions }> = [];
  const plan = {
    id, title: "Plan", status: "ACTIVE", timezone: "UTC", planVersion: 1,
    createdAt: now, updatedAt: now, archivedAt: null,
    items: [{
      id: itemId, lectureId, sequence: 1, sessionCount: 1, focusDurationSeconds: 60,
      breakDurationSeconds: 0, includeMcq: true, includeFlashcards: false, includeVideo: true,
    }],
  };
  const api = createFocusApi(async (path, options = {}) => {
    calls.push({ path: String(path), options });
    return response({ plan });
  });
  await api.createFocusPlan({
    title: "Plan", timezone: "UTC",
    items: [{ id: itemId, lectureId, sequence: 1, sessionCount: 1, focusDurationSeconds: 60, breakDurationSeconds: 0, includeMcq: true, includeFlashcards: false, includeVideo: true }],
  });
  assert.deepEqual(JSON.parse(String(calls[0].options.body)), {
    title: "Plan", timezone: "UTC",
    items: [{ lectureId, sequence: 1, sessionCount: 1, focusDurationSeconds: 60, breakDurationSeconds: 0, includeMcq: true, includeFlashcards: false, includeVideo: true }],
  });
});

test("Focus API distinguishes semantic HTTP, transport, and protocol failures", async () => {
  const httpApi = createFocusApi(async () => response({ error: "bad", code: "INVALID_SESSION_STATE" }, 409));
  await assert.rejects(httpApi.getCurrentFocusSession(), (error: unknown) =>
    error instanceof FocusApiError && error.kind === "http" && error.code === "INVALID_SESSION_STATE" && error.status === 409);

  const transportApi = createFocusApi(async () => { throw new TypeError("network down"); });
  await assert.rejects(transportApi.getCurrentFocusSession(), (error: unknown) =>
    error instanceof FocusApiError && error.kind === "transport");

  const malformedApi = createFocusApi(async () => response({ session: null }));
  await assert.rejects(malformedApi.getCurrentFocusSession(), (error: unknown) =>
    error instanceof FocusApiError && error.kind === "protocol");
});

test("Focus API rejects malformed session DTOs", async () => {
  const api = createFocusApi(async () => response({
    session: { ...session(), id: "not-an-id" },
    serverNow: now,
  }));
  await assert.rejects(api.getCurrentFocusSession(), (error: unknown) =>
    error instanceof FocusApiError && error.kind === "protocol");
});

test("Quick Note, metrics, and post-Focus client methods use authenticated canonical routes", async () => {
  const note = {
    id,
    focusSessionId: itemId,
    lectureId,
    content: "Private note",
    status: "ACTIVE",
    convertedToPlanItemId: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    convertedAt: null,
  };
  const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
  const client = createFocusApi(async (path, options = {}) => {
    const route = String(path);
    const method = options.method;
    const body = options.body ? JSON.parse(String(options.body)) as unknown : undefined;
    calls.push({ path: route, method, body });
    if (route.endsWith("/quick-notes") && method === "POST") {
      return response({ note, idempotency: "CREATED" }, 201);
    }
    if (
      (route.endsWith("/quick-notes") || route.includes("/quick-notes?")) &&
      (method === undefined || method === "GET")
    ) {
      return response({ notes: [note] });
    }
    if (route.endsWith("/convert-to-plan-item")) {
      return response({
        note: { ...note, status: "CONVERTED", convertedToPlanItemId: itemId, convertedAt: now },
        planItem: {
          id: itemId, planId, lectureId, sequence: 2, sessionCount: 1,
          focusDurationSeconds: 2_700, breakDurationSeconds: 0,
          includeMcq: true, includeFlashcards: false, includeVideo: true,
        },
        idempotency: "CONVERTED",
      }, 201);
    }
    if (route.includes("/quick-notes/")) {
      const responseNote = method === "POST"
        ? { ...note, status: "ARCHIVED", archivedAt: now }
        : method === "PATCH" ? { ...note, content: "Edited" } : note;
      return response({ note: responseNote });
    }
    if (route.endsWith("/metrics?period=last7Days")) {
      return response({
        period: "last7Days",
        timezone: "Asia/Baghdad",
        startDate: "2026-09-20",
        endDate: "2026-09-26",
        totals: { focusSeconds: 60, sessionsCompleted: 1, interruptionCount: 0 },
        daily: [{
          date: "2026-09-26", focusSeconds: 60, sessionsCompleted: 1, interruptionCount: 0,
        }],
      });
    }
    if (route.endsWith("/post-actions")) {
      return response({
        sessionId: id, lectureId, planId, planItemId: itemId,
        sessionNumber: 1, plannedSessionCount: 1,
        isLastPlannedSession: true, manualLectureCompletionRequired: true,
        configured: { mcq: false, flashcards: true, video: true },
        available: { mcq: true, flashcards: true, video: false },
      });
    }
    return response({ error: "not found", code: "NOT_FOUND" }, 404);
  });

  await client.createQuickNote({
    focusSessionId: itemId,
    content: "Private note",
    idempotencyKey: "client-note-create",
  });
  await client.listQuickNotes({ sessionId: itemId, status: "ACTIVE", limit: 7 });
  await client.getQuickNote(id);
  await client.updateQuickNote(id, { content: "Edited" });
  await client.archiveQuickNote(id);
  await client.convertQuickNote(id, { targetPlanId: planId });
  await client.getMetrics("last7Days");
  await client.getPostFocusActionContext(id);

  assert.deepEqual(calls.map(({ path, method }) => [method, path]), [
    ["POST", "/api/focus/quick-notes"],
    [undefined, `/api/focus/quick-notes?sessionId=${itemId}&status=ACTIVE&limit=7`],
    [undefined, `/api/focus/quick-notes/${id}`],
    ["PATCH", `/api/focus/quick-notes/${id}`],
    ["POST", `/api/focus/quick-notes/${id}/archive`],
    ["POST", `/api/focus/quick-notes/${id}/convert-to-plan-item`],
    [undefined, "/api/focus/metrics?period=last7Days"],
    [undefined, `/api/focus/sessions/${id}/post-actions`],
  ]);
  assert.deepEqual(calls[0].body, {
    focusSessionId: itemId,
    content: "Private note",
    idempotencyKey: "client-note-create",
  });
  assert.deepEqual(calls[5].body, { targetPlanId: planId });
});

test("Focus history and terminal summaries validate canonical responses and preserve filters", async () => {
  const note = {
    id,
    focusSessionId: itemId,
    lectureId,
    content: "Private summary note",
    status: "ACTIVE",
    convertedToPlanItemId: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    convertedAt: null,
  };
  const summary = {
    sessionId: itemId,
    status: "COMPLETED",
    plan: { id: planId, title: "Plan", status: "ACTIVE" },
    lecture: { id: lectureId, title: "Lecture", subject: "Chemistry" },
    progress: {
      sessionNumber: 1,
      plannedSessionCount: 2,
      isLastPlannedSession: false,
      completedSessions: 1,
      totalPlannedSessions: 2,
    },
    timing: {
      plannedFocusSeconds: 2_700,
      verifiedFocusSeconds: 2_650,
      plannedBreakSeconds: 300,
      startedAt: now,
      terminalAt: now,
    },
    points: { amount: 5, reasonCode: "focus.verified_completion" },
    resources: {
      launchCount: 1,
      uniqueResourceCount: 1,
      items: [{ resourceId: id, resourceType: "PDF", title: "Notes", launchCount: 1 }],
    },
    quickNotes: [note],
    nextAction: {
      kind: "NEXT_SESSION",
      planItemId: itemId,
      lectureId,
      lectureTitle: "Lecture",
    },
  };
  const history = {
    items: [{
      sessionId: itemId,
      status: "COMPLETED",
      planId,
      planTitle: "Plan",
      planStatus: "ACTIVE",
      planItemId: itemId,
      lectureId,
      lectureTitle: "Lecture",
      subject: "Chemistry",
      plannedFocusSeconds: 2_700,
      verifiedFocusSeconds: 2_650,
      startedAt: now,
      terminalAt: now,
      points: 5,
      resourceLaunchCount: 1,
      uniqueResourceCount: 1,
    }],
    nextCursor: null,
    limit: 1,
  };
  const calls: string[] = [];
  const client = createFocusApi(async (path) => {
    calls.push(String(path));
    return String(path).includes("/summary")
      ? response(summary)
      : response(history);
  });
  const summaryResult = await client.getSessionSummary(itemId);
  const historyResult = await client.listHistory({
    limit: 1,
    status: "COMPLETED",
    subject: "Chemistry",
    lectureId,
  });
  assert.equal(summaryResult.timing.verifiedFocusSeconds, 2_650);
  assert.equal(summaryResult.quickNotes[0]?.content, "Private summary note");
  assert.equal(historyResult.items[0]?.points, 5);
  assert.equal("quickNotes" in (historyResult.items[0] ?? {}), false);
  assert.deepEqual(calls, [
    `/api/focus/sessions/${itemId}/summary`,
    `/api/focus/history?limit=1&status=COMPLETED&subject=Chemistry&lectureId=${lectureId}`,
  ]);

  const malformed = createFocusApi(async () => response({ ...summary, status: "UNKNOWN" }));
  await assert.rejects(malformed.getSessionSummary(itemId), (error: unknown) =>
    error instanceof FocusApiError && error.kind === "protocol");
});