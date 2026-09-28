import type { FocusApi } from "./api/focusApi";

export type FocusPlanRecord = Awaited<ReturnType<FocusApi["getFocusPlan"]>>;
export type FocusSessionRecord = NonNullable<
  Awaited<ReturnType<FocusApi["getCurrentFocusSession"]>>["session"]
>;

export const FOCUS_PLAN_LIMITS = Object.freeze({
  maxItems: 100,
  maxSessionsPerItem: 100,
  minStudySeconds: 60,
  maxStudySeconds: 6 * 60 * 60,
  maxBreakSeconds: 3 * 60 * 60,
});

export const FOCUS_PRESETS = [
  { id: "POMODORO_25_5", studyMinutes: 25, breakMinutes: 5 },
  { id: "FOCUS_45_10", studyMinutes: 45, breakMinutes: 10 },
  { id: "FOCUS_50_10", studyMinutes: 50, breakMinutes: 10 },
  { id: "DEEP_90_20", studyMinutes: 90, breakMinutes: 20 },
  { id: "CUSTOM", studyMinutes: null, breakMinutes: null },
] as const;

export type FocusPresetId = (typeof FOCUS_PRESETS)[number]["id"];

export interface FocusPlanDraftItem {
  id?: string;
  lectureId: string;
  sessionCount: number;
  focusDurationSeconds?: number;
  breakDurationSeconds?: number;
  includeMcq: boolean;
  includeFlashcards: boolean;
  includeVideo: boolean;
}

export interface FocusPlanDraft {
  presetId: FocusPresetId;
  studyMinutes: number;
  breakMinutes: number;
  items: FocusPlanDraftItem[];
}

export interface FocusPlanEstimateItem {
  lectureId: string;
  sessionCount: number;
  studyMinutes: number;
  breakMinutes: number;
  totalMinutes: number;
}

export interface FocusPlanEstimate {
  lectureCount: number;
  sessionCount: number;
  studyMinutes: number;
  breakMinutes: number;
  totalMinutes: number;
  items: FocusPlanEstimateItem[];
}

export function createEmptyFocusPlanDraft(): FocusPlanDraft {
  return {
    presetId: "POMODORO_25_5",
    studyMinutes: 25,
    breakMinutes: 5,
    items: [],
  };
}

export function getPresetId(studyMinutes: number, breakMinutes: number): FocusPresetId {
  const match = FOCUS_PRESETS.find(
    (preset) =>
      preset.id !== "CUSTOM" &&
      preset.studyMinutes === studyMinutes &&
      preset.breakMinutes === breakMinutes,
  );
  return match?.id ?? "CUSTOM";
}

export function focusPlanToDraft(plan: FocusPlanRecord): FocusPlanDraft {
  const orderedItems = [...plan.items].sort((left, right) => left.sequence - right.sequence);
  const firstItem = orderedItems[0];
  const studyMinutes = firstItem
    ? Math.max(1, Math.round(firstItem.focusDurationSeconds / 60))
    : 25;
  const breakMinutes = firstItem
    ? Math.max(0, Math.round(firstItem.breakDurationSeconds / 60))
    : 5;

  return {
    presetId: getPresetId(studyMinutes, breakMinutes),
    studyMinutes,
    breakMinutes,
    items: orderedItems.map((item) => ({
      id: item.id,
      lectureId: item.lectureId,
      sessionCount: item.sessionCount,
      focusDurationSeconds: item.focusDurationSeconds,
      breakDurationSeconds: item.breakDurationSeconds,
      includeMcq: item.includeMcq,
      includeFlashcards: item.includeFlashcards,
      includeVideo: item.includeVideo,
    })),
  };
}

export function isValidFocusStudyMinutes(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value * 60 >= FOCUS_PLAN_LIMITS.minStudySeconds &&
    value * 60 <= FOCUS_PLAN_LIMITS.maxStudySeconds
  );
}

export function isValidFocusBreakMinutes(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= 0 &&
    value * 60 <= FOCUS_PLAN_LIMITS.maxBreakSeconds
  );
}

export function isValidFocusSessionCount(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= 1 &&
    value <= FOCUS_PLAN_LIMITS.maxSessionsPerItem
  );
}

export function isValidFocusPlanDraft(draft: FocusPlanDraft): boolean {
  return (
    draft.items.length > 0 &&
    draft.items.length <= FOCUS_PLAN_LIMITS.maxItems &&
    isValidFocusStudyMinutes(draft.studyMinutes) &&
    isValidFocusBreakMinutes(draft.breakMinutes) &&
    draft.items.every(
      (item) =>
        isValidFocusSessionCount(item.sessionCount) &&
        Number.isInteger(item.focusDurationSeconds ?? draft.studyMinutes * 60) &&
        (item.focusDurationSeconds ?? draft.studyMinutes * 60) >=
          FOCUS_PLAN_LIMITS.minStudySeconds &&
        (item.focusDurationSeconds ?? draft.studyMinutes * 60) <=
          FOCUS_PLAN_LIMITS.maxStudySeconds &&
        Number.isInteger(item.breakDurationSeconds ?? draft.breakMinutes * 60) &&
        (item.breakDurationSeconds ?? draft.breakMinutes * 60) >= 0 &&
        (item.breakDurationSeconds ?? draft.breakMinutes * 60) <=
          FOCUS_PLAN_LIMITS.maxBreakSeconds,
    )
  );
}

export function estimateFocusPlan(draft: FocusPlanDraft): FocusPlanEstimate {
  const sessionCount = draft.items.reduce((sum, item) => sum + item.sessionCount, 0);
  const studySeconds = draft.items.reduce(
    (sum, item) =>
      sum + item.sessionCount * (item.focusDurationSeconds ?? draft.studyMinutes * 60),
    0,
  );
  let breakSeconds = 0;
  let remainingSessions = sessionCount;

  const items = draft.items.map((item) => {
    remainingSessions -= item.sessionCount;
    const itemBreakCount =
      Math.max(0, item.sessionCount - 1) + (remainingSessions > 0 ? 1 : 0);
    const itemStudyMinutes =
      (item.sessionCount * (item.focusDurationSeconds ?? draft.studyMinutes * 60)) / 60;
    const itemBreakMinutes =
      (itemBreakCount * (item.breakDurationSeconds ?? draft.breakMinutes * 60)) / 60;
    breakSeconds +=
      itemBreakCount * (item.breakDurationSeconds ?? draft.breakMinutes * 60);
    return {
      lectureId: item.lectureId,
      sessionCount: item.sessionCount,
      studyMinutes: itemStudyMinutes,
      breakMinutes: itemBreakMinutes,
      totalMinutes: itemStudyMinutes + itemBreakMinutes,
    };
  });

  const studyMinutes = studySeconds / 60;
  const breakMinutes = breakSeconds / 60;
  return {
    lectureCount: draft.items.length,
    sessionCount,
    studyMinutes,
    breakMinutes,
    totalMinutes: studyMinutes + breakMinutes,
    items,
  };
}

export function focusPlanItemsFromDraft(
  draft: FocusPlanDraft,
  includeExistingIds: boolean,
) {
  return draft.items.map((item, index) => ({
    ...(includeExistingIds && item.id ? { id: item.id } : {}),
    lectureId: item.lectureId,
    sequence: index + 1,
    sessionCount: item.sessionCount,
    focusDurationSeconds: item.focusDurationSeconds ?? draft.studyMinutes * 60,
    breakDurationSeconds: item.breakDurationSeconds ?? draft.breakMinutes * 60,
    includeMcq: item.includeMcq,
    includeFlashcards: item.includeFlashcards,
    includeVideo: item.includeVideo,
  }));
}

export function areFocusPlanDraftsEqual(
  left: FocusPlanDraft,
  right: FocusPlanDraft,
): boolean {
  if (
    left.presetId !== right.presetId ||
    left.studyMinutes !== right.studyMinutes ||
    left.breakMinutes !== right.breakMinutes ||
    left.items.length !== right.items.length
  ) {
    return false;
  }

  return left.items.every((item, index) => {
    const other = right.items[index];
    return (
      item.id === other.id &&
      item.lectureId === other.lectureId &&
      item.sessionCount === other.sessionCount &&
      item.focusDurationSeconds === other.focusDurationSeconds &&
      item.breakDurationSeconds === other.breakDurationSeconds &&
      item.includeMcq === other.includeMcq &&
      item.includeFlashcards === other.includeFlashcards &&
      item.includeVideo === other.includeVideo
    );
  });
}