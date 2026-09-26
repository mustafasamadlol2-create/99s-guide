import type { LeaderboardScope } from "./types.js";
import { LeaderboardError } from "./errors.js";

const TIME_ZONE = "Asia/Baghdad";
const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  calendar: "gregory",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type CalendarDate = { year: number; month: number; day: number };
type WallClock = CalendarDate & { hour: number; minute: number; second: number };

export type LeaderboardSeasonWindow = {
  scope: LeaderboardScope;
  seasonKey: string;
  startsAt: Date | null;
  endsAt: Date | null;
};

export type ServerOwnedSemesterBoundary = {
  seasonKey: string;
  startsAt: Date;
  endsAt: Date;
};

/**
 * Production semester boundaries are intentionally empty until an authoritative
 * server-owned academic contract is supplied. Tests may pass explicit fixtures.
 */
export const SERVER_OWNED_SEMESTER_BOUNDARIES:
readonly ServerOwnedSemesterBoundary[] = [];

function calendarParts(instant: Date): WallClock {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    throw new LeaderboardError(
      "LEADERBOARD_INVALID_INPUT",
      "Season reference time is invalid.",
    );
  }
  const values = Object.fromEntries(
    DATE_FORMATTER.formatToParts(instant)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function utcCalendarDate(date: CalendarDate): Date {
  const result = new Date(0);
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCFullYear(date.year, date.month - 1, date.day);
  return result;
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const result = utcCalendarDate(date);
  result.setUTCDate(result.getUTCDate() + days);
  return {
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate(),
  };
}

function utcWallClockDate(value: WallClock): Date {
  const result = utcCalendarDate(value);
  result.setUTCHours(value.hour, value.minute, value.second, 0);
  return result;
}

function atBaghdadMidnight(date: CalendarDate): Date {
  const intendedUtc = utcCalendarDate(date);
  let candidate = intendedUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = calendarParts(candidate);
    const observedUtc = utcWallClockDate(observed);
    candidate = new Date(candidate.getTime() - (observedUtc.getTime() - intendedUtc.getTime()));
  }
  const verified = calendarParts(candidate);
  if (
    verified.year !== date.year
    || verified.month !== date.month
    || verified.day !== date.day
    || verified.hour !== 0
    || verified.minute !== 0
    || verified.second !== 0
  ) {
    throw new LeaderboardError(
      "LEADERBOARD_INVALID_INPUT",
      "Baghdad midnight could not be represented for this season boundary.",
    );
  }
  return candidate;
}

function isoWeekKey(monday: CalendarDate): string {
  const thursday = addCalendarDays(monday, 3);
  const weekYear = thursday.year;
  const jan4: CalendarDate = { year: weekYear, month: 1, day: 4 };
  const jan4Weekday = utcCalendarDate(jan4).getUTCDay();
  const weekOneMonday = addCalendarDays(jan4, jan4Weekday === 0 ? -6 : 1 - jan4Weekday);
  const week = Math.floor(
    (utcCalendarDate(monday).getTime() - utcCalendarDate(weekOneMonday).getTime())
      / (7 * 24 * 60 * 60 * 1000),
  ) + 1;
  return `weekly:${String(weekYear).padStart(4, "0")}-W${String(week).padStart(2, "0")}`;
}

export function validateSeasonKey(
  scope: LeaderboardScope,
  seasonKey: string,
): boolean {
  if (typeof seasonKey !== "string" || seasonKey.length > 64) return false;
  if (scope === "WEEKLY") {
    const match = /^weekly:(\d{4})-W(\d{2})$/u.exec(seasonKey);
    return Boolean(match && Number(match[2]) >= 1 && Number(match[2]) <= 53);
  }
  if (scope === "MONTHLY") {
    const match = /^monthly:(\d{4})-(\d{2})$/u.exec(seasonKey);
    return Boolean(match && Number(match[2]) >= 1 && Number(match[2]) <= 12);
  }
  if (scope === "ALL_TIME") return seasonKey === "all-time";
  return /^semester:[a-z0-9][a-z0-9-]{0,54}$/u.test(seasonKey);
}

export function getLeaderboardSeasonWindow(
  scope: LeaderboardScope,
  asOf: Date,
  semesterBoundaries: readonly ServerOwnedSemesterBoundary[] =
    SERVER_OWNED_SEMESTER_BOUNDARIES,
): LeaderboardSeasonWindow {
  const local = calendarParts(asOf);
  if (scope === "WEEKLY") {
    const localDate = { year: local.year, month: local.month, day: local.day };
    const weekday = utcCalendarDate(localDate).getUTCDay();
    const monday = addCalendarDays(localDate, weekday === 0 ? -6 : 1 - weekday);
    const nextMonday = addCalendarDays(monday, 7);
    return {
      scope,
      seasonKey: isoWeekKey(monday),
      startsAt: atBaghdadMidnight(monday),
      endsAt: atBaghdadMidnight(nextMonday),
    };
  }
  if (scope === "MONTHLY") {
    const first: CalendarDate = { year: local.year, month: local.month, day: 1 };
    const next = local.month === 12
      ? { year: local.year + 1, month: 1, day: 1 }
      : { year: local.year, month: local.month + 1, day: 1 };
    return {
      scope,
      seasonKey: `monthly:${String(local.year).padStart(4, "0")}-${String(local.month).padStart(2, "0")}`,
      startsAt: atBaghdadMidnight(first),
      endsAt: atBaghdadMidnight(next),
    };
  }
  if (scope === "ALL_TIME") {
    return { scope, seasonKey: "all-time", startsAt: null, endsAt: null };
  }
  const matching = semesterBoundaries.filter((boundary) => {
    if (
      !(boundary.startsAt instanceof Date)
      || !(boundary.endsAt instanceof Date)
      || !Number.isFinite(boundary.startsAt.getTime())
      || !Number.isFinite(boundary.endsAt.getTime())
      || boundary.startsAt >= boundary.endsAt
      || !validateSeasonKey("SEMESTER", boundary.seasonKey)
    ) {
      throw new LeaderboardError(
        "LEADERBOARD_SEASON_CONFIGURATION_CONFLICT",
        "Server-owned semester configuration is invalid.",
      );
    }
    return boundary.startsAt <= asOf && asOf < boundary.endsAt;
  });
  if (matching.length !== 1) {
    throw new LeaderboardError(
      "LEADERBOARD_SEASON_CONFIGURATION_MISSING",
      matching.length > 1
        ? "Server-owned semester configuration contains overlapping boundaries."
        : "No server-owned semester boundaries are configured for this date.",
    );
  }
  const period = matching[0]!;
  return {
    scope,
    seasonKey: period.seasonKey,
    startsAt: new Date(period.startsAt),
    endsAt: new Date(period.endsAt),
  };
}