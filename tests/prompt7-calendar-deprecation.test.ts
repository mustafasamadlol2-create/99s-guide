import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  filterAcademicCalendarEvents,
  isAcademicCalendarEvent,
} from "../src/core/calendar/academicEvents.js";
import { isLegacyPersonalCalendarMutation } from "../src/core/offline/legacyCalendarMutation.js";
import { deprecateLegacyCalendarEvents } from "../server/services/calendarPersonalPolicy.js";
import type { CalendarEvent } from "../src/core/types.js";

const serverSource = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const calendarViewSource = readFileSync(
  new URL("../src/features/calendar/components/CalendarView.tsx", import.meta.url),
  "utf8",
);
const calendarHookSource = readFileSync(
  new URL("../src/features/calendar/hooks/useCalendar.ts", import.meta.url),
  "utf8",
);

test("academic event filtering excludes dormant personal planner rows", () => {
  const global: CalendarEvent = {
    id: "academic-global",
    title: "Exam",
    type: "exam",
    date: "2026-09-24",
    time: "09:00",
    description: "",
    isPublic: true,
    userId: null,
  };
  const personal: CalendarEvent = { ...global, id: "personal-1", userId: "student-1" };
  const oldTask: CalendarEvent = { ...global, id: "task_old", isPublic: false };

  assert.equal(isAcademicCalendarEvent(global), true);
  assert.equal(isAcademicCalendarEvent(personal), false);
  assert.equal(isAcademicCalendarEvent(oldTask), false);
  assert.deepEqual(filterAcademicCalendarEvents([global, personal, oldTask]), [global]);
});

test("legacy offline planner mutations are terminal and unrelated mutations remain valid", () => {
  assert.equal(isLegacyPersonalCalendarMutation({
    type: "ADD_EVENT",
    payload: { id: "task_old", type: "other", isPublic: false },
  }), true);
  assert.equal(isLegacyPersonalCalendarMutation({
    type: "ADD_EVENT",
    payload: { id: "legacy-no-type", title: "private task", date: "2026-09-24", time: "09:00" },
  }), true);
  assert.equal(isLegacyPersonalCalendarMutation({
    type: "DELETE_EVENT",
    payload: "task_old",
  }), true);
  assert.equal(isLegacyPersonalCalendarMutation({
    type: "ADD_EVENT",
    payload: { eventType: "EXAM", targetGroups: ["ALL"] },
  }), false);
  assert.equal(isLegacyPersonalCalendarMutation({
    type: "UPDATE_PROGRESS",
    payload: { lectureId: "lecture-1" },
  }), false);
});

test("legacy sync compatibility field is always empty and non-mutating", () => {
  const legacyPayload = [{ id: "task_old", title: "private task", userId: "student-1" }];
  assert.deepEqual(deprecateLegacyCalendarEvents(legacyPayload), []);
  assert.match(serverSource, /app\.post\("\/api\/auth\/sync"/u);
  assert.match(serverSource, /deprecateLegacyCalendarEvents\(req\.body\.calendarEvents\)/u);
  assert.match(serverSource, /calendarEvents: \[\]/u);
  const syncStart = serverSource.indexOf('app.post("/api/auth/sync"');
  assert.doesNotMatch(
    serverSource.slice(syncStart, syncStart + 18000),
    /calendarEvent\.upsert/u,
  );
});

test("student Schedule surfaces remain academic-only and read-only", () => {
  assert.match(serverSource, /app\.get\("\/api\/calendar\/events", requireUser/u);
  assert.match(serverSource, /where: \{ userId: null \}/u);
  assert.match(appSource, /filterAcademicCalendarEvents/u);
  assert.doesNotMatch(calendarHookSource, /handleCreateTaskSubmit|newTaskTitle|linkedLectureId|isAddingTask/u);
  assert.doesNotMatch(calendarViewSource, /onAddEvent|onUpdateEvents|handleChangeGroup/u);
  assert.match(calendarViewSource, /CalendarViewProps/u);
  assert.match(calendarViewSource, /activeView/u);
});

test("academic mutation authorization and compatibility storage boundaries remain present", () => {
  assert.match(serverSource, /app\.post\("\/api\/calendar\/events", requireAdmin/u);
  assert.match(serverSource, /app\.put\("\/api\/calendar\/events\/:id", requireAdmin/u);
  assert.match(serverSource, /app\.delete\("\/api\/calendar\/events\/:id", requireAdmin/u);
  assert.match(serverSource, /userId: null, AND:/u);
  assert.match(readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8"), /userId\s+String\?/u);
  assert.match(
    readFileSync(new URL("../cloudflare-private-data-api/src/index.ts", import.meta.url), "utf8"),
    /UserCalendarEvent/u,
  );
});