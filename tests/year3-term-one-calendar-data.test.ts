import assert from "node:assert/strict";
import test from "node:test";

import {
  buildYear3TermOne2026Events,
  YEAR3_TERM_ONE_2026_COUNTS,
} from "../src/features/calendar/data/year3TermOne2026";

const events = buildYear3TermOne2026Events();

test("official timetable import has the expected totals and no notifications", () => {
  assert.equal(events.length, YEAR3_TERM_ONE_2026_COUNTS.total);
  assert.equal(events.filter((e) => e.eventType === "LECTURE").length, 541);
  assert.equal(events.filter((e) => e.eventType === "HOLIDAY").length, 18);
  assert.equal(events.filter((e) => e.eventType === "EXAM").length, 2);
  assert.ok(events.every((e) => e.sendNotification === false));
  assert.equal(new Set(events.map((e) => e.clientId)).size, events.length);
});

test("27 September follows the requested group/stream mapping", () => {
  const onDate = events.filter((e) => e.startDateTime.startsWith("2026-09-27"));
  const find = (title: string, start: string, groups: string[]) =>
    onDate.find(
      (e) =>
        e.title === title &&
        e.startDateTime.includes(`T${start}:00`) &&
        JSON.stringify(e.targetGroups) === JSON.stringify(groups),
    );

  assert.ok(find("CA-S1", "08:00", ["A"]));
  assert.ok(find("ID-P1", "08:00", ["B"]));
  assert.ok(find("ID-5 C.Med", "11:00", ["A"]));
  assert.ok(find("CA-4 ME", "12:00", ["A"]));
  assert.ok(find("ID-6 Micro", "11:00", ["D", "E"]));
  assert.ok(find("RM-5", "12:00", ["D", "E"]));
});

test("Thursday uses 09-12 practical and 12-14 theory slots", () => {
  const onDate = events.filter((e) => e.startDateTime.startsWith("2026-10-01"));
  assert.ok(
    onDate.some(
      (e) =>
        e.title === "ID-P1" &&
        e.startDateTime.includes("T09:00:00") &&
        e.endDateTime.includes("T12:00:00") &&
        e.targetGroups.join(",") === "A",
    ),
  );
  assert.ok(
    onDate.some(
      (e) =>
        e.title === "NT-6 C.Med" &&
        e.startDateTime.includes("T12:00:00") &&
        e.targetGroups.join(",") === "A",
    ),
  );
  assert.ok(
    onDate.some(
      (e) =>
        e.title === "ID-10 Micro" &&
        e.startDateTime.includes("T13:00:00") &&
        e.targetGroups.join(",") === "A",
    ),
  );
});

test("weekends and the two mid-module exams are all-day global events", () => {
  const weekends = events.filter((e) => e.eventType === "HOLIDAY");
  assert.equal(weekends.length, 18);
  assert.ok(weekends.every((e) => e.title === "Weekend" && e.allDay));
  assert.deepEqual(weekends.map((e) => e.targetGroups), Array(18).fill(["ALL"]));

  const exams = events.filter((e) => e.eventType === "EXAM");
  assert.deepEqual(
    exams.map((e) => [e.startDateTime.slice(0, 10), e.title]),
    [
      ["2026-11-02", "NT Mid Module Exam"],
      ["2026-11-03", "RM Mid Module Exam"],
    ],
  );
  assert.ok(exams.every((e) => e.allDay && e.targetGroups.join(",") === "ALL"));
});

test("import range stops after the requested 1 December schedule", () => {
  const lectureDates = events
    .filter((e) => e.eventType === "LECTURE")
    .map((e) => e.startDateTime.slice(0, 10));
  assert.equal(lectureDates[0], "2026-09-27");
  assert.equal(lectureDates.at(-1), "2026-12-01");
  assert.ok(!lectureDates.some((date) => date > "2026-12-01"));
});
