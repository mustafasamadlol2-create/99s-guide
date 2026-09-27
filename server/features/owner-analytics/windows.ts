import {
  getBaghdadCalendarMidnightDaysBefore,
  getLeaderboardSeasonWindow,
} from "../leaderboard/periods.js";

export const OWNER_ANALYTICS_WINDOW_PRESETS = [
  "LAST_7_DAYS",
  "LAST_30_DAYS",
  "CURRENT_SEMESTER",
] as const;

export type OwnerAnalyticsWindowPreset = (typeof OWNER_ANALYTICS_WINDOW_PRESETS)[number];

export class OwnerAnalyticsWindowError extends Error {
  constructor(
    readonly code: "INVALID_WINDOW" | "SEMESTER_CONFIGURATION_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "OwnerAnalyticsWindowError";
  }
}

export function isOwnerAnalyticsWindowPreset(value: unknown): value is OwnerAnalyticsWindowPreset {
  return typeof value === "string"
    && OWNER_ANALYTICS_WINDOW_PRESETS.some((preset) => preset === value);
}

export function resolveOwnerAnalyticsWindow(
  preset: OwnerAnalyticsWindowPreset,
  asOf: Date,
): { from: Date; to: Date; asOf: Date } {
  if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime())) {
    throw new OwnerAnalyticsWindowError("INVALID_WINDOW", "Server time is invalid.");
  }
  if (preset === "LAST_7_DAYS") {
    return {
      from: getBaghdadCalendarMidnightDaysBefore(asOf, 6),
      to: new Date(asOf),
      asOf: new Date(asOf),
    };
  }
  if (preset === "LAST_30_DAYS") {
    return {
      from: getBaghdadCalendarMidnightDaysBefore(asOf, 29),
      to: new Date(asOf),
      asOf: new Date(asOf),
    };
  }

  try {
    const semester = getLeaderboardSeasonWindow("SEMESTER", asOf);
    if (!semester.startsAt) {
      throw new OwnerAnalyticsWindowError(
        "SEMESTER_CONFIGURATION_UNAVAILABLE",
        "Current semester configuration is unavailable.",
      );
    }
    return {
      from: semester.startsAt,
      to: new Date(asOf),
      asOf: new Date(asOf),
    };
  } catch {
    throw new OwnerAnalyticsWindowError(
      "SEMESTER_CONFIGURATION_UNAVAILABLE",
      "Current semester configuration is unavailable.",
    );
  }
}