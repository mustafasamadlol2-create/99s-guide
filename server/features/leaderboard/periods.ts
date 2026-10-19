import {
  LEADERBOARD_SCOPES,
  type LeaderboardScope,
} from "./types.js";
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
 * Baghdad-local calendar dates for configured terms. Add future academic terms
 * here; the last listed date is inclusive and is converted to an exclusive
 * midnight boundary below.
 */
const SERVER_OWNED_SEMESTER_DATES = [
  {
    seasonKey: "semester:fall-2026",
    startsOn: "2026-09-01",
    endsOn: "2027-01-31",
  },
  {
    seasonKey: "semester:spring-2027",
    startsOn: "2027-02-01",
    endsOn: "2027-06-30",
  },
] as const;

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

function parseCalendarDate(value: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) {
    throw new LeaderboardError(
      "LEADERBOARD_SEASON_CONFIGURATION_CONFLICT",
      "Server-owned semester dates must use YYYY-MM-DD.",
    );
  }
  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const normalized = utcCalendarDate(date);
  if (
    normalized.getUTCFullYear() !== date.year
    || normalized.getUTCMonth() + 1 !== date.month
    || normalized.getUTCDate() !== date.day
  ) {
    throw new LeaderboardError(
      "LEADERBOARD_SEASON_CONFIGURATION_CONFLICT",
      "Server-owned semester date is not a valid calendar day.",
    );
  }
  return date;
}

export const SERVER_OWNED_SEMESTER_BOUNDARIES:
readonly ServerOwnedSemesterBoundary[] = SERVER_OWNED_SEMESTER_DATES.map((term) => {
  const startsOn = parseCalendarDate(term.startsOn);
  const endsOn = parseCalendarDate(term.endsOn);
  if (utcCalendarDate(endsOn) < utcCalendarDate(startsOn)) {
    throw new LeaderboardError(
      "LEADERBOARD_SEASON_CONFIGURATION_CONFLICT",
      "Server-owned semester end date precedes its start date.",
    );
  }
  return {
    seasonKey: term.seasonKey,
    startsAt: atBaghdadMidnight(startsOn),
    endsAt: atBaghdadMidnight(addCalendarDays(endsOn, 1)),
  };
});

/**
 * Return a Baghdad-local calendar midnight relative to a server-owned instant.
 * Shared with fixed owner analytics windows so UTC offsets and calendar-day
 * boundaries stay consistent with leaderboard season calculations.
 */
export function getBaghdadCalendarMidnightDaysBefore(
  asOf: Date,
  daysBefore: number,
): Date {
  if (!Number.isInteger(daysBefore) || daysBefore < 0 || daysBefore > 366) {
    throw new RangeError("Baghdad calendar day offset is invalid.");
  }
  const local = calendarParts(asOf);
  return atBaghdadMidnight(addCalendarDays(
    { year: local.year, month: local.month, day: local.day },
    -daysBefore,
  ));
}

function weeklySundayKey(sunday: CalendarDate): string {
  return `weekly:${String(sunday.year).padStart(4, "0")}-${String(sunday.month).padStart(2, "0")}-${String(sunday.day).padStart(2, "0")}`;
}

function isValidSundayWeeklyKey(seasonKey: string): boolean {
  const match = /^weekly:(\d{4})-(\d{2})-(\d{2})$/u.exec(seasonKey);
  if (!match) return false;
  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const normalized = utcCalendarDate(date);
  return normalized.getUTCFullYear() === date.year
    && normalized.getUTCMonth() + 1 === date.month
    && normalized.getUTCDate() === date.day
    && normalized.getUTCDay() === 0;
}

export function validateSeasonKey(
  scope: LeaderboardScope,
  seasonKey: string,
): boolean {
  if (typeof seasonKey !== "string" || seasonKey.length > 64) return false;
  if (scope === "WEEKLY") {
    // New canonical weekly seasons are Sunday 00:00 through the following
    // Sunday 00:00 in Asia/Baghdad. Keep legacy ISO-Monday keys readable so
    // previously finalized snapshots/cursors remain valid history.
    if (isValidSundayWeeklyKey(seasonKey)) return true;
    const legacy = /^weekly:(\d{4})-W(\d{2})$/u.exec(seasonKey);
    return Boolean(legacy && Number(legacy[2]) >= 1 && Number(legacy[2]) <= 53);
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
    const sunday = addCalendarDays(localDate, -weekday);
    const nextSunday = addCalendarDays(sunday, 7);
    return {
      scope,
      // Date-based key deliberately avoids colliding with already-persisted
      // ISO/Monday seasons created by earlier releases. This lets the corrected
      // Sunday-to-Saturday week become active without mutating historical rows.
      seasonKey: weeklySundayKey(sunday),
      startsAt: atBaghdadMidnight(sunday),
      endsAt: atBaghdadMidnight(nextSunday),
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

export function getAvailableLeaderboardScopes(
  asOf: Date,
  semesterBoundaries: readonly ServerOwnedSemesterBoundary[] =
    SERVER_OWNED_SEMESTER_BOUNDARIES,
): LeaderboardScope[] {
  let semesterAvailable = false;
  try {
    getLeaderboardSeasonWindow("SEMESTER", asOf, semesterBoundaries);
    semesterAvailable = true;
  } catch (error) {
    if (
      !(error instanceof LeaderboardError)
      || (
        error.code !== "LEADERBOARD_SEASON_CONFIGURATION_MISSING"
        && error.code !== "LEADERBOARD_SEASON_CONFIGURATION_CONFLICT"
      )
    ) {
      throw error;
    }
  }
  return LEADERBOARD_SCOPES.filter((scope) =>
    scope !== "SEMESTER" || semesterAvailable);
}