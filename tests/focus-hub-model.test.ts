import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyFocusPlanDraft,
  estimateFocusPlan,
  FOCUS_PRESETS,
  focusPlanItemsFromDraft,
  focusPlanToDraft,
  isValidFocusBreakMinutes,
  isValidFocusPlanDraft,
  isValidFocusSessionCount,
  isValidFocusStudyMinutes,
  type FocusPlanRecord,
} from "../src/features/focus/focusHubModel";

test("Focus planner limits match the server's duration and queue boundaries", () => {
  const emptyDraft = createEmptyFocusPlanDraft();
  assert.equal(emptyDraft.presetId, "POMODORO_25_5");
  assert.equal(isValidFocusPlanDraft(emptyDraft), false);
  assert.equal(isValidFocusStudyMinutes(1), true);
  assert.equal(isValidFocusStudyMinutes(360), true);
  assert.equal(isValidFocusStudyMinutes(0), false);
  assert.equal(isValidFocusStudyMinutes(361), false);
  assert.equal(isValidFocusBreakMinutes(0), true);
  assert.equal(isValidFocusBreakMinutes(180), true);
  assert.equal(isValidFocusBreakMinutes(181), false);
  assert.equal(isValidFocusSessionCount(1), true);
  assert.equal(isValidFocusSessionCount(100), true);
  assert.equal(isValidFocusSessionCount(101), false);
  assert.deepEqual(
    FOCUS_PRESETS.map((preset) => [
      preset.id,
      preset.studyMinutes,
      preset.breakMinutes,
    ]),
    [
      ["POMODORO_25_5", 25, 5],
      ["FOCUS_45_10", 45, 10],
      ["FOCUS_50_10", 50, 10],
      ["DEEP_90_20", 90, 20],
      ["CUSTOM", null, null],
    ],
  );
});

test("plan estimates include breaks between sessions but not after the final session", () => {
  const draft = createEmptyFocusPlanDraft();
  draft.items = [
    {
      lectureId: "lecture-a",
      sessionCount: 2,
      includeMcq: false,
      includeFlashcards: false,
      includeVideo: false,
    },
    {
      lectureId: "lecture-b",
      sessionCount: 1,
      includeMcq: false,
      includeFlashcards: false,
      includeVideo: false,
    },
  ];

  assert.deepEqual(estimateFocusPlan(draft), {
    lectureCount: 2,
    sessionCount: 3,
    studyMinutes: 75,
    breakMinutes: 10,
    totalMinutes: 85,
    items: [
      {
        lectureId: "lecture-a",
        sessionCount: 2,
        studyMinutes: 50,
        breakMinutes: 10,
        totalMinutes: 60,
      },
      {
        lectureId: "lecture-b",
        sessionCount: 1,
        studyMinutes: 25,
        breakMinutes: 0,
        totalMinutes: 25,
      },
    ],
  });
});

test("canonical plans load in sequence order and retain planner-safe options", () => {
  const plan = {
    id: "plan-id",
    title: "Saved",
    status: "ACTIVE",
    timezone: "Asia/Baghdad",
    planVersion: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    archivedAt: null,
    items: [
      {
        id: "item-b",
        lectureId: "lecture-b",
        sequence: 2,
        sessionCount: 2,
        focusDurationSeconds: 2700,
        breakDurationSeconds: 600,
        includeMcq: true,
        includeFlashcards: false,
        includeVideo: true,
      },
      {
        id: "item-a",
        lectureId: "lecture-a",
        sequence: 1,
        sessionCount: 1,
        focusDurationSeconds: 2700,
        breakDurationSeconds: 600,
        includeMcq: false,
        includeFlashcards: true,
        includeVideo: false,
      },
    ],
  } satisfies FocusPlanRecord;

  const draft = focusPlanToDraft(plan);
  assert.equal(draft.presetId, "FOCUS_45_10");
  assert.deepEqual(draft.items.map((item) => item.id), ["item-a", "item-b"]);
  assert.deepEqual(
    draft.items.map((item) => [
      item.lectureId,
      item.includeMcq,
      item.includeFlashcards,
      item.includeVideo,
    ]),
    [
      ["lecture-a", false, true, false],
      ["lecture-b", true, false, true],
    ],
  );
  assert.equal(isValidFocusPlanDraft(draft), true);

  const savedItems = focusPlanItemsFromDraft(draft, true);
  assert.deepEqual(savedItems.map((item) => item.id), ["item-a", "item-b"]);
  assert.deepEqual(savedItems.map((item) => item.sequence), [1, 2]);
});

test("editing estimates preserve canonical per-lecture durations and omit the final break", () => {
  const plan = {
    id: "plan-id",
    title: "Mixed durations",
    status: "ACTIVE",
    timezone: "Asia/Baghdad",
    planVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    archivedAt: null,
    items: [
      {
        id: "item-a",
        lectureId: "lecture-a",
        sequence: 1,
        sessionCount: 2,
        focusDurationSeconds: 1500,
        breakDurationSeconds: 600,
        includeMcq: false,
        includeFlashcards: false,
        includeVideo: false,
      },
      {
        id: "item-b",
        lectureId: "lecture-b",
        sequence: 2,
        sessionCount: 1,
        focusDurationSeconds: 2700,
        breakDurationSeconds: 1200,
        includeMcq: false,
        includeFlashcards: false,
        includeVideo: false,
      },
    ],
  } satisfies FocusPlanRecord;

  const draft = focusPlanToDraft(plan);
  const savedItems = focusPlanItemsFromDraft(draft, true);
  assert.deepEqual(
    savedItems.map((item) => [
      item.focusDurationSeconds,
      item.breakDurationSeconds,
    ]),
    [
      [1500, 600],
      [2700, 1200],
    ],
  );

  const estimate = estimateFocusPlan(draft);
  assert.equal(estimate.studyMinutes, 95);
  assert.equal(estimate.breakMinutes, 20);
  assert.equal(estimate.totalMinutes, 115);
});
