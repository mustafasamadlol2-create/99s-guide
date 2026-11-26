import type { CalendarEvent, User } from "../types";

/**
 * Academic Schedule rows are global rows. Legacy planner rows either carry a
 * user owner or the old task marker/private flag and must never hydrate the
 * Schedule after the compatibility cutoff.
 */
export function isAcademicCalendarEvent(event: CalendarEvent): boolean {
  return event.userId == null && event.isPublic !== false && !event.id.startsWith("task_");
}

export function filterAcademicCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
  return events.filter(isAcademicCalendarEvent);
}

export function filterAcademicCalendarForAccount(
  events: CalendarEvent[],
  account: Pick<User, "role" | "studentGroup"> | null,
): CalendarEvent[] {
  if (!account) return [];
  if (account.role === "admin" || account.role === "owner") return filterAcademicCalendarEvents(events);
  const group = account.studentGroup?.trim().toUpperCase();
  return events.filter((event) => {
    if (!isAcademicCalendarEvent(event)) return false;
    const groups = Array.isArray(event.targetGroups) ? event.targetGroups : String(event.targetGroups ?? "").split(",");
    return groups.some((value) => {
      const target = String(value).trim().toUpperCase();
      return target === "ALL" || (!!group && target === group);
    });
  });
}
