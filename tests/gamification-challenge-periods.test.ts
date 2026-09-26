import assert from "node:assert/strict";
import test from "node:test";
import {
  addBaghdadCalendarDays,
  getBaghdadWeekPeriod,
} from "../server/features/gamification/challengePeriods.js";

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Baghdad",
  calendar: "gregory",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function localDateTime(date: Date): string {
  return fmt.format(date).replace(", ", "T");
}

test("rejects invalid effective dates", () => {
  assert.throws(() => getBaghdadWeekPeriod(new Date("not a date")), TypeError);
  assert.throws(() => getBaghdadWeekPeriod(null as unknown as Date), TypeError);
});

test("period starts at Monday 00:00 in Asia/Baghdad", () => {
  const period = getBaghdadWeekPeriod(new Date("2026-09-24T20:59:59.999Z"));
  assert.equal(period.periodKey, "2026-09-21");
  assert.equal(localDateTime(period.startsAt), "2026-09-21T00:00");
  assert.equal(localDateTime(period.endsAt), "2026-09-28T00:00");
});

test("Sunday before Monday remains in the prior period", () => {
  const sunday = getBaghdadWeekPeriod(new Date("2026-09-27T20:59:59.999Z"));
  assert.equal(sunday.periodKey, "2026-09-21");
});

test("Monday exactly at the boundary belongs to the new period", () => {
  const atBoundary = getBaghdadWeekPeriod(new Date("2026-09-28T21:00:00.000Z"));
  assert.equal(atBoundary.periodKey, "2026-09-28");
});

test("adjacent periods share their exact boundary", () => {
  const first = getBaghdadWeekPeriod(new Date("2024-02-28T12:00:00.000Z"));
  const second = getBaghdadWeekPeriod(first.endsAt);
  assert.equal(first.endsAt.getTime(), second.startsAt.getTime());
  assert.equal(second.periodKey, "2024-03-04");
});

test("calendar arithmetic crosses a leap day without assuming 7*24 hours", () => {
  const period = getBaghdadWeekPeriod(new Date("2024-02-29T12:00:00.000Z"));
  assert.equal(period.periodKey, "2024-02-26");
  const end = addBaghdadCalendarDays({ year: 2024, month: 2, day: 26 }, 7);
  assert.deepEqual(end, { year: 2024, month: 3, day: 4 });
  assert.ok(period.endsAt.getTime() > period.startsAt.getTime());
});