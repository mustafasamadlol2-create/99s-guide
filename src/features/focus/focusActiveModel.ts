export interface FocusPlanItemProgression {
  id: string;
  sequence: number;
  sessionCount: number;
  breakDurationSeconds: number;
}

export interface CompletedFocusProgress {
  planItemId: string;
  isLastPlannedSession: boolean;
}

export type FocusProgression =
  | {
      kind: "next";
      nextItem: FocusPlanItemProgression;
      breakDurationSeconds: number;
    }
  | { kind: "complete" }
  | { kind: "unavailable" };

export function deriveFocusProgression(
  items: readonly FocusPlanItemProgression[],
  completed: CompletedFocusProgress,
): FocusProgression {
  const currentItem = items.find((item) => item.id === completed.planItemId);
  if (!currentItem) return { kind: "unavailable" };

  const orderedItems = [...items].sort((a, b) => a.sequence - b.sequence);
  const nextItem = completed.isLastPlannedSession
    ? orderedItems.find((item) => item.sequence > currentItem.sequence)
    : currentItem;

  if (!nextItem) return { kind: "complete" };

  return {
    kind: "next",
    nextItem,
    // Break time belongs to the session that just ended, not the upcoming item.
    breakDurationSeconds: Math.max(0, currentItem.breakDurationSeconds),
  };
}

export function formatFocusClock(totalSeconds: number | null | undefined): string {
  const safeSeconds = Math.max(
    0,
    Number.isFinite(totalSeconds) ? Math.floor(totalSeconds ?? 0) : 0,
  );
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const seconds = safeSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}