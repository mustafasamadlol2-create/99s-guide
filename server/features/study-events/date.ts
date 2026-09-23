const BAGHDAD_TIME_ZONE = "Asia/Baghdad";
const NORMAL_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const OFFLINE_MAX_AGE_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export function parseOccurredAt(value: Date | string, now = new Date(), source?: string): Date {
  const occurredAt = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new Error("occurredAt must be a valid date.");
  }

  const nowMs = now.getTime();
  const occurredMs = occurredAt.getTime();
  if (occurredMs > nowMs + FUTURE_TOLERANCE_MS) {
    throw new Error("occurredAt is outside the allowed future tolerance.");
  }

  const maxAge = source === "offline_replay" ? OFFLINE_MAX_AGE_MS : NORMAL_MAX_AGE_MS;
  if (occurredMs < nowMs - maxAge) {
    throw new Error("occurredAt is outside the allowed historical window.");
  }
  return occurredAt;
}

export function getBaghdadMetricDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Metric date source is invalid.");

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BAGHDAD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function metricDateAsUtcDate(metricDate: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(metricDate)) {
    throw new Error("Metric date must be an ISO calendar date.");
  }
  return new Date(`${metricDate}T00:00:00.000Z`);
}