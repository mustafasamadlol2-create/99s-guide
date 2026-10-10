import assert from "node:assert/strict";
import test from "node:test";
import { createFocusApi, FocusApiError, type FocusApiRequestOptions } from "../src/features/focus/api/focusApi.ts";
import { invalidateFocusResources } from "../src/features/focus/api/focusSync.ts";

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
  assert.match(String(calls[0].options.requestKey), /^anonymous\|current-session:current:\d+$/);
  assert.match(String((calls[1].options.headers as Record<string, string>)["X-Focus-Client-ID"]), /^[A-Za-z0-9._-]{8,128}$/);
  assert.deepEqual(JSON.parse(String(calls[1].options.body)), {
    planId: id, planItemId: itemId, idempotencyKey: "start-key", source: "web",
  });
  assert.deepEqual(JSON.parse(String(calls[3].options.body)), { idempotencyKey: "complete-key" });
});

test("Focus break API reads durable state and uses idempotent transitions", async () => {
  const calls: Array<{ path: string; options: FocusApiRequestOptions }> = [];
  const breakSession = {
    id: lectureId,
    focusSessionId: id,
    durationSeconds: 600,
    startedAt: now,
    endsAt: "2025-01-01T00:10:00.000Z",
    endedAt: null,
    resumeStudyOnReturn: true,
    isPaused: false,
    remainingSeconds: 600,
  };
  const api = createFocusApi(async (path, options = {}) => {
    const route = String(path);
    calls.push({ path: route, options });
    if (route.endsWith("/break")) {
      return response({ session: session("PAUSED"), breakSession, serverNow: now });
    }
    if (route.endsWith("/break/pause")) {
      return response({
        session: session("PAUSED"),
        breakSession: { ...breakSession, isPaused: true, remainingSeconds: 575 },
        serverNow: now,
        idempotency: "FIRST_SEEN",
      }, 201);
    }
    if (route.endsWith("/break/resume")) {
      return response({
        session: session("PAUSED"),
        breakSession: { ...breakSession, remainingSeconds: 575 },
        serverNow: now,
        idempotency: "FIRST_SEEN",
      }, 201);
    }
    return response({
      session: session(route.endsWith("/return") ? "ACTIVE" : "PAUSED"),
      breakSession: route.endsWith("/return") ? { ...breakSession, endedAt: now, remainingSeconds: 0 } : breakSession,
      serverNow: now,
      idempotency: "FIRST_SEEN",
    }, 201);
  });

  const snapshot = await api.getFocusBreak(id);
  const started = await api.startFocusBreak(id, { idempotencyKey: "break-start-key", source: "web" });
  const paused = await api.pauseFocusBreak(id, { idempotencyKey: "break-pause-key", source: "web" });
  const resumed = await api.resumeFocusBreak(id, { idempotencyKey: "break-resume-key", source: "web" });
  const returned = await api.returnFromFocusBreak(id, { idempotencyKey: "break-return-key", source: "pwa" });

  assert.equal(snapshot.breakSession?.remainingSeconds, 600);
  assert.equal(started.session.status, "PAUSED");
  assert.equal(paused.breakSession.isPaused, true);
  assert.equal(resumed.breakSession.isPaused, false);
  assert.equal(returned.session.status, "ACTIVE");
  assert.deepEqual(calls.map(({ path }) => path), [
    `/api/focus/sessions/${id}/break`,
    `/api/focus/sessions/${id}/break/start`,
    `/api/focus/sessions/${id}/break/pause`,
    `/api/focus/sessions/${id}/break/resume`,
    `/api/focus/sessions/${id}/break/return`,
  ]);
  assert.deepEqual(JSON.parse(String(calls[1].options.body)), {
    idempotencyKey: "break-start-key",
    source: "web",
  });
  assert.deepEqual(JSON.parse(String(calls[2].options.body)), {
    idempotencyKey: "break-pause-key",
    source: "web",
  });
  assert.deepEqual(JSON.parse(String(calls[3].options.body)), {
    idempotencyKey: "break-resume-key",
    source: "web",
  });
  assert.deepEqual(JSON.parse(String(calls[4].options.body)), {
    idempotencyKey: "break-return-key",
    source: "pwa",
  });
});

test("Focus abandonment accepts the committed terminal response", async () => {
  const calls: Array<{ path: string; options: FocusApiRequestOptions }> = [];
  const api = createFocusApi(async (path, options = {}) => {
    calls.push({ path: String(path), options });
    return response({
      session: {
        ...session("ABANDONED"),
        actualEndedAt: now,
        completionReason: "USER_ABANDONED",
      },
      idempotency: "FIRST_SEEN",
    });
  });

  const result = await api.abandonFocusSession(id, { idempotencyKey: "abandon-key" });

  assert.equal(result.session.status, "ABANDONED");
  assert.equal(calls[0].path, `/api/focus/sessions/${id}/abandon`);
  assert.deepEqual(JSON.parse(String(calls[0].options.body)), {
    idempotencyKey: "abandon-key",
  });
});

test("concurrent current-session reads share a request key and invalidation starts a new read epoch", async () => {
  const keys: Array<string | undefined> = [];
  const request = async (_path: RequestInfo | URL, options: FocusApiRequestOptions = {}) => {
    keys.push(options.requestKey);
    return response({ session: null, serverNow: now });
  };
  const firstApi = createFocusApi(request);
  const secondApi = createFocusApi(request);

  await Promise.all([
    firstApi.getCurrentFocusSession(),
    secondApi.getCurrentFocusSession(),
  ]);

  assert.equal(keys.length, 1);
  const firstKey = keys[0];
  assert.match(String(firstKey), /^anonymous\|current-session:current:\d+$/);
  invalidateFocusResources({ resources: ["current-session"] });
  await firstApi.getCurrentFocusSession();
  assert.equal(keys.length, 2);
  assert.notEqual(keys[1], firstKey);
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

test("metrics and post-Focus client methods use authenticated canonical routes", async () => {
  const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
  const client = createFocusApi(async (path, options = {}) => {
    const route = String(path);
    const method = options.method;
    const body = options.body ? JSON.parse(String(options.body)) as unknown : undefined;
    calls.push({ path: route, method, body });
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

  await client.getMetrics("last7Days");
  await client.getPostFocusActionContext(id);

  assert.deepEqual(calls.map(({ path, method }) => [method, path]), [
    [undefined, "/api/focus/metrics?period=last7Days"],
    [undefined, `/api/focus/sessions/${id}/post-actions`],
  ]);
});

test("Focus history and terminal summaries validate canonical responses and preserve filters", async () => {
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
    nextCursor: Buffer.from(JSON.stringify([now, itemId]), "utf8").toString("base64url"),
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
  assert.equal(historyResult.items[0]?.points, 5);
  assert.equal(historyResult.nextCursor, history.nextCursor);
  assert.deepEqual(calls, [
    `/api/focus/sessions/${itemId}/summary`,
    `/api/focus/history?limit=1&status=COMPLETED&subject=Chemistry&lectureId=${lectureId}`,
  ]);

  const malformed = createFocusApi(async () => response({ ...summary, status: "UNKNOWN" }));
  await assert.rejects(malformed.getSessionSummary(itemId), (error: unknown) =>
    error instanceof FocusApiError && error.kind === "protocol");
});