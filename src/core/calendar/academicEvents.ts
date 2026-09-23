import { CalendarEvent } from "../types";

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