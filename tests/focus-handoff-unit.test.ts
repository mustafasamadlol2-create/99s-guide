import assert from "node:assert/strict";
import test from "node:test";

import {
  interruptionRecordSchema,
  resourceHandoffReturnSchema,
  resourceHandoffStartSchema,
} from "../server/features/focus/schemas.js";
import { buildFocusTimerSnapshot } from "../server/features/focus/timer.js";

const start = new Date("2026-09-24T06:00:00.000Z");
const end = new Date(start.getTime() + 45 * 60_000);

test("handoff return accepts the client target state and rejects extra fields", () => {
  assert.equal(resourceHandoffReturnSchema.safeParse({
    targetState: "ACTIVE",
    idempotencyKey: "handoff-return-1",
    source: "ios",
  }).success, true);
  assert.equal(resourceHandoffReturnSchema.safeParse({
    targetState: "PAUSED",
    idempotencyKey: "handoff-return-1",
    source: "ios",
  }).success, false);
});

test("handoff timer credits wall time but caps elapsed active time at target", () => {
  const snapshot = buildFocusTimerSnapshot({
    session: {
      status: "RESOURCE_HANDOFF",
      startedAt: start,
      plannedEndAt: end,
      lastCheckpointAt: new Date(start.getTime() + 40 * 60_000),
      activeSeconds: 40 * 60,
      pauseSeconds: 0,
    },
    now: new Date(start.getTime() + 75 * 60_000),
  });
  assert.equal(snapshot.targetSeconds, 45 * 60);
  assert.equal(snapshot.elapsedActiveSeconds, 45 * 60);
  assert.equal(snapshot.remainingSeconds, 0);
  assert.equal(snapshot.completionEligible, false);
});

test("handoff and interruption inputs remain bounded and canonical", () => {
  assert.equal(resourceHandoffStartSchema.safeParse({
    resourceType: "PDF",
    resourceId: "not-a-url-or-arbitrary-value",
    idempotencyKey: "handoff-start-1",
    source: "web",
  }).success, false);
  assert.equal(interruptionRecordSchema.safeParse({
    observedAwaySeconds: 0,
    reason: "background_absence",
    idempotencyKey: "interruption-1",
    source: "web",
  }).success, false);
  assert.equal(interruptionRecordSchema.safeParse({
    observedAwaySeconds: 120,
    reason: "cheating",
    idempotencyKey: "interruption-1",
    source: "web",
  }).success, false);
});