import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import "dayjs/locale/ar";

// Extend Day.js with necessary plugins
dayjs.extend(utc);
dayjs.extend(timezone);

const BAGHDAD_TZ = "Asia/Baghdad";

/**
 * Parses a database ISO string or local date object into Asia/Baghdad timezone Day.js object,
 * preventing any browser-level local shifts.
 */
export function parseBaghdadDate(
  dateTime: string | Date | undefined,
): dayjs.Dayjs {
  if (!dateTime) return dayjs().tz(BAGHDAD_TZ);
  // If we have Z or UTC representation, use utc() first then tz(), otherwise parse with tz
  if (
    typeof dateTime === "string" &&
    (dateTime.endsWith("Z") ||
      dateTime.includes("+") ||
      dateTime.includes("GMT"))
  ) {
    return dayjs.utc(dateTime).tz(BAGHDAD_TZ);
  }
  return dayjs(dateTime).tz(BAGHDAD_TZ);
}

/**
 * Takes administrative wall-clock picker input (e.g., "2026-06-01T08:00") and
 * maps it directly/locks it to Asia/Baghdad timezone (e.g., "2026-06-01T08:00:00+03:00").
 */
export function formatToBaghdadISO(localDateTimeStr: string): string {
  if (!localDateTimeStr) return "";
  return dayjs.tz(localDateTimeStr, BAGHDAD_TZ).format();
}

/**
 * Gets localized Date & Time parts in Baghdad timezone.
 */
export function getBaghdadDateParts(dateTime: string | Date) {
  const d = parseBaghdadDate(dateTime);
  return {
    year: d.format("YYYY"),
    month: d.format("MM"),
    day: d.format("DD"),
    hh: d.format("HH"),
    mm: d.format("mm"),
    dateString: d.format("YYYY-MM-DD"),
    timeString: d.format("HH:mm"),
  };
}

export { dayjs };
