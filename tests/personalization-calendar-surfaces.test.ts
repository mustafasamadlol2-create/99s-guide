import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const files = {
  view: readFileSync(
    new URL("../src/features/calendar/components/CalendarView.tsx", import.meta.url),
    "utf8",
  ),
  header: readFileSync(
    new URL("../src/features/calendar/components/CalendarHeader.tsx", import.meta.url),
    "utf8",
  ),
  month: readFileSync(
    new URL("../src/features/calendar/components/CalendarMonthView.tsx", import.meta.url),
    "utf8",
  ),
  week: readFileSync(
    new URL("../src/features/calendar/components/CalendarWeekView.tsx", import.meta.url),
    "utf8",
  ),
  day: readFileSync(
    new URL("../src/features/calendar/components/CalendarDayView.tsx", import.meta.url),
    "utf8",
  ),
  eventIcon: readFileSync(
    new URL("../src/features/calendar/components/EventIcon.tsx", import.meta.url),
    "utf8",
  ),
  pager: readFileSync(
    new URL("../src/features/calendar/hooks/useCalendarViewPager.ts", import.meta.url),
    "utf8",
  ),
  calendarHook: readFileSync(
    new URL("../src/features/calendar/hooks/useCalendar.ts", import.meta.url),
    "utf8",
  ),
};

const calendarSources = Object.values(files);

test("Calendar generic neutral shells use exact Classic 99 tokens", () => {
  assert.match(files.view, /bg-semantic-surface-elevated/);
  assert.match(files.view, /text-semantic-chrome-content-primary/);
  assert.match(files.view, /text-semantic-chrome-content-secondary/);
  assert.match(files.header, /bg-semantic-surface-elevated/);
  assert.match(files.header, /text-semantic-chrome-content-primary/);
  assert.match(files.header, /text-semantic-chrome-content-secondary/);
  assert.match(files.month, /bg-semantic-surface-elevated/);
  assert.match(files.month, /text-semantic-chrome-content-secondary/);
  assert.match(files.week, /text-semantic-chrome-content-secondary/);
  assert.match(files.day, /text-semantic-chrome-content-secondary/);
});

test("Today and selected-date semantics remain independent", () => {
  assert.match(files.view, /text-rose-600 dark:text-\[#FF453A\]/);
  assert.match(files.view, /bg-rose-600 dark:bg-\[#FF453A\]/);
  assert.match(files.month, /text-\[#ff3b30\] font-bold/);
  assert.match(files.month, /border-\[#ff3b30\]/);
  assert.match(files.week, /text-\[#ff3b30\] font-semibold/);
  assert.match(files.week, /border-\[#ff3b30\]/);
  assert.match(files.day, /text-\[#ff3b30\] font-semibold/);
  assert.match(files.day, /border-\[#ff3b30\]/);
  assert.match(files.week, /text-neutral-900 dark:text-white font-semibold/);
  assert.match(files.day, /text-neutral-900 dark:text-white font-semibold/);
});

test("Event and exam colors remain domain-specific", () => {
  for (const source of [files.eventIcon, files.month, files.week, files.day]) {
    assert.match(source, /red-100|red-50|text-red|#EF4444/);
    assert.match(source, /orange-100|orange-50|text-orange|#F97316/);
    assert.match(source, /blue-100|blue-50|text-blue|#2563EB/);
    assert.match(source, /emerald-100|emerald-50|text-emerald|#10B981/);
  }
  assert.doesNotMatch(files.eventIcon, /semantic-action-accent|semantic-navigation-tab-active|themeId/);
});

test("Calendar pager preserves RTL-aware view transitions and has no theme dependency", () => {
  assert.match(files.pager, /VIEW_ORDER: CalendarViewMode\[\] = \["week", "day", "month"\]/);
  assert.match(files.pager, /isRtlRef/);
  assert.match(files.pager, /const logicalDelta = isRtlRef\.current/);
  assert.match(files.pager, /horizontalLockMaxVerticalRatio/);
  assert.match(files.pager, /commitProgress/);
  assert.match(files.pager, /touchstart/);
  assert.match(files.pager, /touchmove/);
  assert.match(files.pager, /touchend/);
  assert.doesNotMatch(files.pager, /personalization|themeId|dataset\.theme|style\.setProperty/);
});

test("Month, Week, and Day logic remains present and timezone handling is unchanged", () => {
  assert.match(files.view, /getBaghdadDateParts/);
  assert.match(files.view, /processedEvents/);
  assert.match(files.view, /selectedFilterGroups/);
  assert.match(files.month, /chronologicalEvents/);
  assert.match(files.month, /getEventPriority/);
  assert.match(files.week, /activeWeekDays/);
  assert.match(files.week, /handleTouchMove/);
  assert.match(files.day, /parseLocalDate/);
  assert.match(files.day, /eventClusters/);
  assert.match(files.calendarHook, /formatLocalDate\(new Date\(\)\)/);
  assert.match(files.calendarHook, /handlePrevMonth/);
  assert.match(files.calendarHook, /handleNextWeek/);
  assert.match(files.calendarHook, /handlePrevDay/);
});

test("No Calendar file mutates runtime theme state", () => {
  for (const source of calendarSources) {
    assert.doesNotMatch(source, /dataset\.theme|classList\.(?:add|remove|toggle)\([^)]*theme|style\.setProperty|location\.reload|reload\(\)/);
  }
});