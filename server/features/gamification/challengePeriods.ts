const BAGHDAD_TIME_ZONE = "Asia/Baghdad";

type BaghdadCalendarDate = {
  year: number;
  month: number;
  day: number;
};

export type BaghdadWeekPeriod = {
  periodKey: string;
  startsAt: Date;
  endsAt: Date;
};

const BAGHDAD_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: BAGHDAD_TIME_ZONE,
  calendar: "gregory",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function partsAt(instant: Date): BaghdadCalendarDate & {
  hour: number;
  minute: number;
  second: number;
} {
  const values = Object.fromEntries(
    BAGHDAD_DATE_FORMATTER.formatToParts(instant)
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

function utcCalendarDate(date: BaghdadCalendarDate): Date {
  const result = new Date(0);
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCFullYear(date.year, date.month - 1, date.day);
  return result;
}

function utcWallClockDate(
  date: BaghdadCalendarDate & { hour: number; minute: number; second: number },
): Date {
  const result = utcCalendarDate(date);
  result.setUTCHours(date.hour, date.minute, date.second, 0);
  return result;
}

/** Adds calendar days, deliberately avoiding elapsed-millisecond arithmetic. */
export function addBaghdadCalendarDays(
  date: BaghdadCalendarDate,
  days: number,
): BaghdadCalendarDate {
  if (
    !Number.isInteger(date.year) ||
    !Number.isInteger(date.month) ||
    !Number.isInteger(date.day) ||
    !Number.isInteger(days) ||
    date.month < 1 ||
    date.month > 12 ||
    date.day < 1 ||
    date.day > 31
  ) {
    throw new TypeError("Baghdad calendar date or day count is invalid.");
  }
  const shifted = utcCalendarDate(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function calendarDateKey(date: BaghdadCalendarDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function atBaghdadMidnight(date: BaghdadCalendarDate): Date {
  // Start with the same fields interpreted as UTC, then correct by the
  // zone's actual offset. Repeating this makes the operation DST-safe.
  let candidate = utcCalendarDate(date);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = partsAt(candidate);
    const observedAsUtc = utcWallClockDate(observed);
    candidate = new Date(
      candidate.getTime() - (observedAsUtc.getTime() - utcCalendarDate(date).getTime()),
    );
  }
  const verified = partsAt(candidate);
  if (
    verified.year !== date.year ||
    verified.month !== date.month ||
    verified.day !== date.day ||
    verified.hour !== 0 ||
    verified.minute !== 0 ||
    verified.second !== 0
  ) {
    throw new Error("Baghdad midnight is not representable for this calendar date.");
  }
  return candidate;
}

export function getBaghdadWeekPeriod(asOf: Date): BaghdadWeekPeriod {
  if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime())) {
    throw new TypeError("Challenge period effective time is invalid.");
  }
  const local = partsAt(asOf);
  const localDate = { year: local.year, month: local.month, day: local.day };
  const weekday = utcCalendarDate(localDate).getUTCDay();
  const monday = addBaghdadCalendarDays(localDate, weekday === 0 ? -6 : 1 - weekday);
  const nextMonday = addBaghdadCalendarDays(monday, 7);
  const startsAt = atBaghdadMidnight(monday);
  const endsAt = atBaghdadMidnight(nextMonday);
  if (startsAt >= endsAt) {
    throw new Error("Computed Baghdad challenge period is invalid.");
  }
  return {
    periodKey: calendarDateKey(monday),
    startsAt,
    endsAt,
  };
}