import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveFocusProgression,
  formatFocusClock,
  type FocusPlanItemProgression,
} from "../src/features/focus/focusActiveModel";

const items: FocusPlanItemProgression[] = [
  { id: "lecture-a", sequence: 1, sessionCount: 2, breakDurationSeconds: 300 },
  { id: "lecture-b", sequence: 2, sessionCount: 1, breakDurationSeconds: 120 },
];

test("continuing a planned lecture round keeps the same queue item", () => {
  const progression = deriveFocusProgression(items, {
    planItemId: "lecture-a",
    isLastPlannedSession: false,
  });

  assert.equal(progression.kind, "next");
  if (progression.kind !== "next") return;
  assert.equal(progression.nextItem.id, "lecture-a");
  assert.equal(progression.breakDurationSeconds, 300);
});

test("ending a lecture's final round advances to the next queued item", () => {
  const progression = deriveFocusProgression(items, {
    planItemId: "lecture-a",
    isLastPlannedSession: true,
  });

  assert.equal(progression.kind, "next");
  if (progression.kind !== "next") return;
  assert.equal(progression.nextItem.id, "lecture-b");
  assert.equal(progression.breakDurationSeconds, 300);
});

test("the final planned round does not create an unnecessary final break", () => {
  const progression = deriveFocusProgression(items, {
    planItemId: "lecture-b",
    isLastPlannedSession: true,
  });

  assert.deepEqual(progression, { kind: "complete" });
});

test("missing canonical plan items do not guess progression", () => {
  assert.deepEqual(
    deriveFocusProgression(items, {
      planItemId: "missing",
      isLastPlannedSession: false,
    }),
    { kind: "unavailable" },
  );
});

test("timer formatting switches to hours only at 60 minutes", () => {
  assert.equal(formatFocusClock(0), "00:00");
  assert.equal(formatFocusClock(3_599), "59:59");
  assert.equal(formatFocusClock(3_600), "01:00:00");
  assert.equal(formatFocusClock(-4), "00:00");
  assert.equal(formatFocusClock(Number.NaN), "00:00");
});