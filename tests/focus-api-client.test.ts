import assert from "node:assert/strict";
import test from "node:test";
import { createFocusApi, FocusApiError, type FocusApiRequestOptions } from "../src/features/focus/api/focusApi.ts";

const id = "00000000-0000-4000-8000-000000000001";
const itemId = "00000000-0000-4000-8000-000000000002";
const lectureId = "00000000-0000-4000-8000-000000000003";
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