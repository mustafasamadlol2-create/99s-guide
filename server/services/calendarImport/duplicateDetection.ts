import type { CalendarCandidate } from "./schemas.js";
import { candidateDateTime, candidateFingerprint } from "./normalize.js";
import { calendarTargetGroupsOverlap } from "../../../shared/calendarContracts.js";

export interface ExistingCalendarEvent {
  id: string;
  title: string;
  eventType: string;
  startDateTime: Date;
  endDateTime: Date;
  targetGroups: string;
  subjectId: string | null;
  importFingerprint: string | null;
}

export interface CandidateComparison {
  duplicate: ExistingCalendarEvent | null;
  conflict: ExistingCalendarEvent | null;
}

function normalizedTitle(title: string | null): string {
  return (title ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function groups(value: string | string[]): string[] {
  return (Array.isArray(value) ? value : value.split(","))
    .map((group) => group.trim().toUpperCase())
    .filter(Boolean);
}

function groupOverlap(left: string[], right: string[]): boolean {
  return calendarTargetGroupsOverlap(left, right);
}

export function intervalsOverlap(
  start: Date,
  end: Date,
  otherStart: Date,
  otherEnd: Date,
): boolean {
  return start < otherEnd && end > otherStart;
}

export function compareCandidateToEvents(
  candidate: CalendarCandidate,
  existingEvents: ExistingCalendarEvent[],
): CandidateComparison {
  const dateTime = candidateDateTime(candidate);
  if (!dateTime || !candidate.title || !candidate.eventType) {
    return { duplicate: null, conflict: null };
  }
  const candidateGroups = groups(candidate.targetGroups);
  const duplicate = existingEvents.find((event) =>
    normalizedTitle(event.title) === normalizedTitle(candidate.title) &&
    event.subjectId === candidate.subjectId &&
    event.startDateTime.getTime() === dateTime.startDateTime.getTime() &&
    event.endDateTime.getTime() === dateTime.endDateTime.getTime() &&
    groupOverlap(candidateGroups, groups(event.targetGroups)),
  ) ?? null;
  const conflict = existingEvents.find((event) =>
    event.eventType !== "HOLIDAY" &&
    candidate.eventType !== "HOLIDAY" &&
    intervalsOverlap(dateTime.startDateTime, dateTime.endDateTime, event.startDateTime, event.endDateTime) &&
    groupOverlap(candidateGroups, groups(event.targetGroups)),
  ) ?? null;
  return { duplicate, conflict };
}

export function markDuplicateAndConflict(
  candidate: CalendarCandidate,
  comparison: CandidateComparison,
): CalendarCandidate {
  if (comparison.duplicate) {
    return {
      ...candidate,
      status: "DUPLICATE",
      selected: false,
      warnings: [...new Set([...candidate.warnings, "An equivalent Calendar event already exists."])],
    };
  }
  if (comparison.conflict) {
    return {
      ...candidate,
      status: "CONFLICT",
      selected: false,
      warnings: [...new Set([...candidate.warnings, "This event overlaps an existing Calendar event for the selected group."])],
    };
  }
  return candidate;
}

export function markWithinImportDuplicates(
  candidates: CalendarCandidate[],
): CalendarCandidate[] {
  const seen = new Set<string>();
  return candidates.map((candidate) => {
    const dateTime = candidateDateTime(candidate);
    const key = dateTime && candidate.title
      ? [
        normalizedTitle(candidate.title),
        candidate.subjectId ?? "",
        dateTime.startDateTime.toISOString(),
        dateTime.endDateTime.toISOString(),
        [...candidate.targetGroups].sort().join(","),
      ].join("|")
      : candidate.candidateId;
    if (seen.has(key)) {
      return {
        ...candidate,
        status: "DUPLICATE",
        selected: false,
        warnings: [...new Set([...candidate.warnings, "Duplicate row within this import."])],
      };
    }
    seen.add(key);
    return candidate;
  });
}

export function markWithinImportConflicts(
  candidates: CalendarCandidate[],
): CalendarCandidate[] {
  const accepted: ExistingCalendarEvent[] = [];
  return candidates.map((candidate) => {
    const marked = markDuplicateAndConflict(
      candidate,
      compareCandidateToEvents(candidate, accepted),
    );
    const dateTime = candidateDateTime(marked);
    if (
      dateTime &&
      marked.title &&
      marked.eventType &&
      marked.status !== "DUPLICATE" &&
      marked.status !== "CONFLICT" &&
      marked.status !== "INVALID"
    ) {
      accepted.push({
        id: marked.candidateId,
        title: marked.title,
        eventType: marked.eventType,
        startDateTime: dateTime.startDateTime,
        endDateTime: dateTime.endDateTime,
        targetGroups: marked.targetGroups.join(","),
        subjectId: marked.subjectId,
        importFingerprint: null,
      });
    }
    return marked;
  });
}

export function computeFingerprint(
  sourceSha256: string,
  candidate: CalendarCandidate,
): string | null {
  const dateTime = candidateDateTime(candidate);
  if (!dateTime || !candidate.date || !candidate.title) return null;
  return candidateFingerprint({
    sourceSha256,
    sourcePage: candidate.sourcePage,
    date: candidate.date,
    startDateTime: dateTime.startDateTime,
    endDateTime: dateTime.endDateTime,
    allDay: candidate.allDay,
    title: candidate.title,
    subjectId: candidate.subjectId,
    targetGroups: candidate.targetGroups,
  });
}