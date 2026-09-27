import {
  getBaghdadCalendarMidnightDaysBefore,
} from "../leaderboard/periods.js";
import {
  OwnerAnalyticsWindowError,
  resolveOwnerAnalyticsWindow,
} from "../owner-analytics/windows.js";
import type {
  StudyAnalyzerWindow,
  StudyAnalyzerWindowName,
} from "./types.js";

export type StudyAnalyzerResolvedWindows = Record<
  StudyAnalyzerWindowName,
  { from: Date; to: Date } | null
>;

export function resolveStudyAnalyzerWindows(asOf: Date): {
  resolved: StudyAnalyzerResolvedWindows;
  dto: Record<StudyAnalyzerWindowName, StudyAnalyzerWindow>;
} {
  const last7 = resolveOwnerAnalyticsWindow("LAST_7_DAYS", asOf);
  const last30 = resolveOwnerAnalyticsWindow("LAST_30_DAYS", asOf);
  let semester: { from: Date; to: Date } | null = null;
  let semesterCode: "SEMESTER_CONFIGURATION_UNAVAILABLE" | undefined;
  try {
    const value = resolveOwnerAnalyticsWindow("CURRENT_SEMESTER", asOf);
    semester = { from: value.from, to: value.to };
  } catch (error) {
    if (error instanceof OwnerAnalyticsWindowError) {
      semesterCode = "SEMESTER_CONFIGURATION_UNAVAILABLE";
    } else {
      throw error;
    }
  }

  const asOfIso = asOf.toISOString();
  const present = (from: Date, to: Date): StudyAnalyzerWindow => ({
    status: "AVAILABLE",
    from: from.toISOString(),
    to: to.toISOString(),
    asOf: asOfIso,
  });
  const unavailable = (): StudyAnalyzerWindow => ({
    status: "UNAVAILABLE",
    from: null,
    to: asOfIso,
    asOf: asOfIso,
    ...(semesterCode ? { code: semesterCode } : {}),
  });

  return {
    resolved: {
      last7Days: { from: last7.from, to: last7.to },
      last30Days: { from: last30.from, to: last30.to },
      currentSemester: semester,
    },
    dto: {
      last7Days: present(last7.from, last7.to),
      last30Days: present(last30.from, last30.to),
      currentSemester: semester ? present(semester.from, semester.to) : unavailable(),
    },
  };
}

export function baghdadDayKey(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) throw new Error("Unable to resolve Baghdad calendar date.");
  return `${year}-${month}-${day}`;
}

export function baghdadHour(value: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Baghdad",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const hour = Number(parts.find((entry) => entry.type === "hour")?.value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error("Unable to resolve Baghdad local hour.");
  }
  return hour;
}

export function baghdadDayStartDaysBefore(asOf: Date, daysBefore: number): Date {
  return getBaghdadCalendarMidnightDaysBefore(asOf, daysBefore);
}

export function calendarDaysBetween(startDay: string, endDay: string): number {
  const start = Date.parse(`${startDay}T00:00:00.000Z`);
  const end = Date.parse(`${endDay}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error("Invalid calendar day key.");
  }
  return Math.round((end - start) / 86_400_000);
}

export function getCurrentAndCompletedWeeks(asOf: Date): {
  currentWeekStart: Date;
  daysElapsedInCurrentWeek: number;
  completedWeeks: Array<{ from: Date; toExclusive: Date }>;
} {
  const todayKey = baghdadDayKey(asOf);
  const weekday = new Date(`${todayKey}T00:00:00.000Z`).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const currentWeekStart = baghdadDayStartDaysBefore(asOf, daysSinceMonday);
  const completedWeeks = Array.from({ length: 4 }, (_, index) => {
    const weeksBeforeCurrent = 4 - index;
    return {
      from: baghdadDayStartDaysBefore(asOf, daysSinceMonday + weeksBeforeCurrent * 7),
      toExclusive: baghdadDayStartDaysBefore(
        asOf,
        daysSinceMonday + (weeksBeforeCurrent - 1) * 7,
      ),
    };
  });
  return {
    currentWeekStart,
    daysElapsedInCurrentWeek: daysSinceMonday + 1,
    completedWeeks,
  };
}