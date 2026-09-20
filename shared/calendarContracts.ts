export const CALENDAR_TARGET_GROUPS = ["A", "B", "C", "D", "E", "ALL"] as const;

export type CalendarTargetGroup = (typeof CALENDAR_TARGET_GROUPS)[number];

export function isCalendarTargetGroup(value: unknown): value is CalendarTargetGroup {
  return typeof value === "string" &&
    (CALENDAR_TARGET_GROUPS as readonly string[]).includes(value.trim().toUpperCase());
}

export function calendarTargetGroupsOverlap(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = left.map((group) => group.trim().toUpperCase()).filter(Boolean);
  const normalizedRight = right.map((group) => group.trim().toUpperCase()).filter(Boolean);
  return normalizedLeft.includes("ALL") ||
    normalizedRight.includes("ALL") ||
    normalizedLeft.some((group) => normalizedRight.includes(group));
}