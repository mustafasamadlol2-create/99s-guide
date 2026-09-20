import { createHash } from "node:crypto";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import {
  CALENDAR_CANDIDATE_STATUSES,
  CALENDAR_EVENT_TYPES,
  CALENDAR_IMPORT_TIMEZONE,
  CALENDAR_SUBJECT_IDS,
  CALENDAR_TARGET_GROUPS,
  type CalendarCandidate,
  type ExtractionCandidate,
} from "./schemas.js";

dayjs.extend(utc);
dayjs.extend(timezone);

export interface NormalizationContext {
  defaultTargetGroups: string[];
  sourcePageCount: number | null;
  sourceImageCount: number;
}

export interface NormalizedCalendarCandidate {
  candidate: CalendarCandidate;
  startDateTime: Date | null;
  endDateTime: Date | null;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function validIsoDate(value: string | null): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = dayjs.utc(`${value}T00:00:00Z`);
  return parsed.isValid() && parsed.format("YYYY-MM-DD") === value;
}

function isAmbiguousNumericDate(value: string | null): boolean {
  return Boolean(value && /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/u.test(value.trim()));
}

function validTime(value: string | null): boolean {
  return Boolean(value && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value));
}

function localDateTime(date: string, time: string): dayjs.Dayjs {
  return dayjs.tz(`${date} ${time}`, CALENDAR_IMPORT_TIMEZONE);
}

function nextLocalDate(date: string): string {
  return dayjs.tz(`${date} 00:00`, CALENDAR_IMPORT_TIMEZONE).add(1, "day").format("YYYY-MM-DD");
}

function normalizeEventType(value: string | null): { value: CalendarCandidate["eventType"]; warning?: string } {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return { value: null, warning: "Event type is missing." };
  const aliases: Record<string, (typeof CALENDAR_EVENT_TYPES)[number]> = {
    SESSION: "LECTURE",
    LECTURE: "LECTURE",
    CLASS: "LECTURE",
    QUIZ: "QUIZ",
    EXAM: "EXAM",
    TEST: "EXAM",
    TASK: "TASK",
    ASSIGNMENT: "TASK",
    PERSONAL: "PERSONAL",
    HOLIDAY: "HOLIDAY",
  };
  const mapped = aliases[normalized];
  return mapped ? { value: mapped } : { value: null, warning: `Unknown event type: ${value}.` };
}

function normalizeSubject(value: string | null, label: string | null): {
  value: CalendarCandidate["subjectId"];
  warning?: string;
} {
  const normalized = value?.trim() ?? "";
  if ((CALENDAR_SUBJECT_IDS as readonly string[]).includes(normalized)) {
    return { value: normalized as CalendarCandidate["subjectId"] };
  }
  const normalizedLabel = label?.trim().toLocaleLowerCase();
  if (!normalizedLabel) return { value: null };
  const aliases: Record<string, (typeof CALENDAR_SUBJECT_IDS)[number]> = {
    nutrition: "NT",
    "research methodology": "RM",
    "clinical attachment": "CA",
    "public health care": "PHC",
    "immune disturbances": "ImD",
    "student-selected component": "SSC",
  };
  const alias = aliases[normalizedLabel];
  return alias
    ? { value: alias }
    : { value: null, warning: `Subject could not be resolved: ${label}.` };
}

function normalizeGroups(raw: string[], defaults: string[]): { value: string[]; warning?: string } {
  const values = [...new Set(raw.map((group) => group.trim().toUpperCase()).filter(Boolean))];
  const selected = values.length > 0 ? values : defaults;
  const unknown = selected.filter((group) => !(CALENDAR_TARGET_GROUPS as readonly string[]).includes(group));
  if (unknown.length > 0) return { value: [], warning: "One or more target groups are invalid." };
  if (selected.includes("ALL")) return { value: ["ALL"] };
  return selected.length > 0 ? { value: selected } : { value: [], warning: "Target group is required." };
}

export function normalizeCandidate(
  raw: ExtractionCandidate,
  candidateId: string,
  context: NormalizationContext,
): NormalizedCalendarCandidate {
  const warnings = [...raw.warnings];
  const date = raw.date && validIsoDate(raw.date) ? raw.date : null;
  if (!date) warnings.push(raw.date ? "Date is invalid." : "Date is missing.");
  if (isAmbiguousNumericDate(raw.rawDate)) warnings.push("Numeric date order is ambiguous.");

  const type = normalizeEventType(raw.eventType);
  if (type.warning) warnings.push(type.warning);
  const subject = normalizeSubject(raw.subjectId, raw.subjectLabelRaw);
  if (subject.warning) warnings.push(subject.warning);
  const groups = normalizeGroups(raw.targetGroups, context.defaultTargetGroups);
  if (groups.warning) warnings.push(groups.warning);

  if (raw.sourcePage !== null && (
    raw.sourcePage < 1 ||
    (context.sourcePageCount !== null && raw.sourcePage > context.sourcePageCount)
  )) warnings.push("Source page is outside the document.");
  if (raw.sourceImageIndex !== null && raw.sourceImageIndex >= context.sourceImageCount) {
    warnings.push("Source image is outside the uploaded image set.");
  }
  if (raw.sourcePage === null && raw.sourceImageIndex === null) {
    warnings.push("Source location is missing.");
  }

  let startDateTime: Date | null = null;
  let endDateTime: Date | null = null;
  if (raw.allDay) {
    if (date) {
      startDateTime = localDateTime(date, "00:00").toDate();
      endDateTime = localDateTime(nextLocalDate(date), "00:00").toDate();
    }
  } else if (!raw.startTime || !validTime(raw.startTime)) {
    warnings.push("Start time is missing or invalid.");
  } else if (!raw.endTime || !validTime(raw.endTime)) {
    warnings.push("End time is missing or invalid.");
  } else if (date) {
    const start = localDateTime(date, raw.startTime);
    const end = localDateTime(date, raw.endTime);
    const explicitOvernight = /overnight|next day|following day/iu.test(
      `${raw.rawStartTime ?? ""} ${raw.rawEndTime ?? ""}`,
    );
    const adjustedEnd = end.isAfter(start)
      ? end
      : explicitOvernight
        ? end.add(1, "day")
        : null;
    if (!adjustedEnd) {
      warnings.push("End time must be after start time.");
    } else {
      startDateTime = start.toDate();
      endDateTime = adjustedEnd.toDate();
    }
  }

  if (!clean(raw.title)) warnings.push("Title is required.");
  const hardInvalid = warnings.some((warning) => [
    "Date is invalid.",
    "Source page is outside the document.",
    "Source image is outside the uploaded image set.",
    "End time must be after start time.",
    "Target group is required.",
  ].includes(warning));
  const reviewRequired = warnings.length > 0 || !date || !type.value || groups.value.length === 0 ||
    (!raw.allDay && (!startDateTime || !endDateTime)) ||
    (raw.allDay && (!startDateTime || !endDateTime));
  const status: CalendarCandidate["status"] = hardInvalid ? "INVALID" : reviewRequired ? "NEEDS_REVIEW" : "VERIFIED";

  return {
    candidate: {
      candidateId,
      title: clean(raw.title),
      eventType: type.value,
      date,
      startTime: raw.allDay ? null : clean(raw.startTime),
      endTime: raw.allDay ? null : clean(raw.endTime),
      allDay: raw.allDay,
      rawDate: clean(raw.rawDate),
      rawStartTime: clean(raw.rawStartTime),
      rawEndTime: clean(raw.rawEndTime),
      subjectId: subject.value,
      subjectLabelRaw: clean(raw.subjectLabelRaw),
      room: clean(raw.room),
      doctor: clean(raw.doctor),
      description: clean(raw.description),
      targetGroups: groups.value as CalendarCandidate["targetGroups"],
      sourcePage: raw.sourcePage,
      sourceImageIndex: raw.sourceImageIndex,
      sourceEvidence: clean(raw.sourceEvidence),
      warnings: [...new Set(warnings)].slice(0, 50),
      verification: { status: "AMBIGUOUS", issues: [] },
      status,
      selected: status === "VERIFIED",
    },
    startDateTime,
    endDateTime,
  };
}

export function applyVerification(
  normalized: NormalizedCalendarCandidate,
  verification: { status: CalendarCandidate["verification"]["status"]; issues: string[] },
): NormalizedCalendarCandidate {
  const candidate = {
    ...normalized.candidate,
    verification: {
      status: verification.status,
      issues: verification.issues.slice(0, 20),
    },
  };
  const criticalMismatch = verification.status !== "SOURCE_MATCH";
  if (criticalMismatch && candidate.status === "VERIFIED") {
    candidate.status = "NEEDS_REVIEW";
    candidate.selected = false;
  }
  if (criticalMismatch) {
    candidate.warnings = [...new Set([...candidate.warnings, ...verification.issues])].slice(0, 50);
  }
  return { ...normalized, candidate };
}

export function candidateFingerprint(input: {
  sourceSha256: string;
  sourcePage: number | null;
  date: string;
  startDateTime: Date;
  endDateTime: Date;
  allDay: boolean;
  title: string;
  subjectId: string | null;
  targetGroups: string[];
}): string {
  const stable = [
    input.sourceSha256,
    input.sourcePage ?? "",
    input.date,
    input.startDateTime.toISOString(),
    input.endDateTime.toISOString(),
    input.allDay ? "1" : "0",
    input.title.trim().normalize("NFKC").toLocaleLowerCase(),
    input.subjectId ?? "",
    [...input.targetGroups].sort().join(","),
  ].join("|");
  return createHash("sha256").update(stable, "utf8").digest("hex");
}

export function candidateDateTime(
  candidate: CalendarCandidate,
): { startDateTime: Date; endDateTime: Date } | null {
  if (!candidate.date) return null;
  if (candidate.allDay) {
    return {
      startDateTime: localDateTime(candidate.date, "00:00").toDate(),
      endDateTime: localDateTime(nextLocalDate(candidate.date), "00:00").toDate(),
    };
  }
  if (!candidate.startTime || !candidate.endTime) return null;
  const start = localDateTime(candidate.date, candidate.startTime);
  const end = localDateTime(candidate.date, candidate.endTime);
  if (!end.isAfter(start)) return null;
  return { startDateTime: start.toDate(), endDateTime: end.toDate() };
}