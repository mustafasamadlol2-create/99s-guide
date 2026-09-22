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
import { MODULE_RESOURCE_LABELS } from "../../../shared/moduleResources.js";

dayjs.extend(utc);
dayjs.extend(timezone);

export interface NormalizationContext {
  defaultTargetGroups: string[];
  sourcePageCount: number | null;
  sourceImageCount: number;
  allowTextSource?: boolean;
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

const digitMap: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

function latinDigits(value: string): string {
  return value.normalize("NFKC").replace(/[٠-٩۰-۹]/gu, (digit) => digitMap[digit] ?? digit);
}

function formatDateParts(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const candidate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return validIsoDate(candidate) ? candidate : null;
}

const monthAliases: Record<string, number> = {
  jan: 1, january: 1, "كانون الثاني": 1, يناير: 1,
  feb: 2, february: 2, شباط: 2, فبراير: 2,
  mar: 3, march: 3, "آذار": 3, اذار: 3, مارس: 3,
  apr: 4, april: 4, نيسان: 4, أبريل: 4, ابريل: 4,
  may: 5, أيار: 5, ايار: 5, مايو: 5,
  jun: 6, june: 6, حزيران: 6, يونيو: 6,
  jul: 7, july: 7, تموز: 7, يوليو: 7,
  aug: 8, august: 8, "آب": 8, اب: 8, أغسطس: 8, اغسطس: 8,
  sep: 9, sept: 9, september: 9, أيلول: 9, ايلول: 9, سبتمبر: 9,
  oct: 10, october: 10, "تشرين الأول": 10, "تشرين الاول": 10, أكتوبر: 10, اكتوبر: 10,
  nov: 11, november: 11, "تشرين الثاني": 11, نوفمبر: 11,
  dec: 12, december: 12, "كانون الأول": 12, "كانون الاول": 12, ديسمبر: 12,
};

function normalizeCalendarDate(value: string | null): string | null {
  if (!value) return null;
  const normalized = latinDigits(value).trim().replace(/\s+/gu, " ");
  if (validIsoDate(normalized)) return normalized;

  let match = normalized.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/u);
  if (match) return formatDateParts(Number(match[1]), Number(match[2]), Number(match[3]));

  // Iraqi academic schedules conventionally use day/month/year.
  match = normalized.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/u);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return formatDateParts(year, Number(match[2]), Number(match[1]));
  }

  const lowered = normalized.toLocaleLowerCase();
  for (const [label, month] of Object.entries(monthAliases).sort((a, b) => b[0].length - a[0].length)) {
    if (!lowered.includes(label)) continue;
    const withoutMonth = lowered.replace(label, " ").replace(/[,،]/gu, " ");
    const numbers = withoutMonth.match(/\d{1,4}/gu)?.map(Number) ?? [];
    if (numbers.length < 2) continue;
    const day = numbers.find((number) => number >= 1 && number <= 31);
    const year = numbers.find((number) => number >= 2000 && number <= 2100);
    if (day && year) return formatDateParts(year, month, day);
  }
  return null;
}

function isAmbiguousNumericDate(value: string | null): boolean {
  if (!value) return false;
  const normalized = latinDigits(value).trim();
  const match = normalized.match(/^(\d{1,2})[/-](\d{1,2})[/-](?:\d{2}|\d{4})$/u);
  return Boolean(match && Number(match[1]) <= 12 && Number(match[2]) <= 12);
}

function normalizeCalendarTime(value: string | null): string | null {
  if (!value) return null;
  let normalized = latinDigits(value)
    .trim()
    .toUpperCase()
    .replace(/\s+/gu, " ")
    .replace(/A\.?\s*M\.?/gu, "AM")
    .replace(/P\.?\s*M\.?/gu, "PM")
    .replace(/ص/gu, "AM")
    .replace(/م/gu, "PM");
  if (/^\d{1,2}\.\d{2}(?:\s*(?:AM|PM))?$/u.test(normalized)) {
    normalized = normalized.replace(".", ":");
  }
  const match = normalized.match(/^(\d{1,2})(?::(\d{1,2}))?\s*(AM|PM)?$/u);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3];
  if (minute < 0 || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "AM") hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  } else if (hour < 0 || hour > 23) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
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
  const normalized = value?.trim().replace(/\s+/gu, " ").toUpperCase();
  if (!normalized) return { value: null, warning: "Event type is missing." };
  const aliases: Record<string, (typeof CALENDAR_EVENT_TYPES)[number]> = {
    SESSION: "LECTURE",
    LECTURE: "LECTURE",
    CLASS: "LECTURE",
    QUIZ: "QUIZ",
    EXAM: "EXAM",
    TASK: "TASK",
    ASSIGNMENT: "TASK",
    PERSONAL: "PERSONAL",
    HOLIDAY: "HOLIDAY",
  };
  const mapped = aliases[normalized];
  if (mapped) return { value: mapped };
  if (normalized === "MIDTERM EXAM" || normalized === "FINAL EXAM") return { value: "EXAM" };
  if (["TEST", "ASSESSMENT", "EVALUATION"].includes(normalized)) {
    return { value: null, warning: "Event type is ambiguous and requires review." };
  }
  return { value: null, warning: `Unknown event type: ${value}.` };
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
  const aliases = Object.fromEntries(
    Object.entries(MODULE_RESOURCE_LABELS).flatMap(([subjectId, labels]) => [
      [labels.en.toLocaleLowerCase(), subjectId],
      [labels.ar, subjectId],
    ]),
  ) as Record<string, (typeof CALENDAR_SUBJECT_IDS)[number]>;
  aliases["student selected component"] = "SSC";
  aliases["student-selected component"] = "SSC";
  const alias = aliases[normalizedLabel ?? ""];
  return alias
    ? { value: alias }
    : { value: null, warning: `Subject could not be resolved: ${label ?? value ?? "missing subject"}.` };
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
  const dateSource = clean(raw.date) ?? clean(raw.rawDate);
  const date = normalizeCalendarDate(dateSource);
  if (!date) warnings.push(dateSource ? "Date is invalid." : "Date is missing.");
  if (isAmbiguousNumericDate(raw.rawDate ?? raw.date)) {
    warnings.push("Numeric date was interpreted using day/month/year order.");
  }
  const startTime = normalizeCalendarTime(clean(raw.startTime) ?? clean(raw.rawStartTime));
  const endTime = normalizeCalendarTime(clean(raw.endTime) ?? clean(raw.rawEndTime));

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
  if (raw.sourcePage === null && raw.sourceImageIndex === null && !context.allowTextSource) {
    warnings.push("Source location is missing.");
  }

  let startDateTime: Date | null = null;
  let endDateTime: Date | null = null;
  if (raw.allDay) {
    if (date) {
      startDateTime = localDateTime(date, "00:00").toDate();
      endDateTime = localDateTime(nextLocalDate(date), "00:00").toDate();
    }
  } else if (!startTime || !validTime(startTime)) {
    warnings.push("Start time is missing or invalid.");
  } else if (!endTime || !validTime(endTime)) {
    warnings.push("End time is missing or invalid.");
  } else if (date) {
    const start = localDateTime(date, startTime);
    const end = localDateTime(date, endTime);
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
    "Source page is outside the document.",
    "Source image is outside the uploaded image set.",
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
      startTime: raw.allDay ? null : startTime,
      endTime: raw.allDay ? null : endTime,
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
  const requiresReview = verification.status !== "SOURCE_MATCH";
  const criticalMismatch = verification.status === "MISMATCH" || verification.status === "NOT_FOUND";
  if (requiresReview && candidate.status === "VERIFIED") {
    candidate.status = "NEEDS_REVIEW";
    candidate.selected = false;
  }
  // An AMBIGUOUS verifier result means the automated cross-check was not
  // decisive; it must not erase a source-derived event type. Only an explicit
  // mismatch/not-found result invalidates that field.
  if (criticalMismatch) candidate.eventType = null;
  if (requiresReview) {
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