import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("server/features/study-streak/service.ts", "utf8");
const route = readFileSync("server/routes/studyStreak.ts", "utf8");
const frontend = readFileSync("src/features/gamification/GamificationFrontend.tsx", "utf8");
const card = readFileSync("src/features/gamification/StudyStreakCard.tsx", "utf8");
const css = readFileSync("src/features/gamification/gamification.css", "utf8");
const server = readFileSync("server.ts", "utf8");

const phase9Files = [
  "FOCUS_CATEGORY_CAP",
  "OVERALL_DAILY_CAP",
  "100 Points/day",
  "daily cap",
];

test("Phase 10 uses verified study activity rather than app opening or login", () => {
  assert.match(service, /studyDailyMetric\.findMany/);
  assert.match(service, /lecture_progress_recorded/);
  assert.match(service, /groupFocusParticipantSummary\.findMany/);
  assert.doesNotMatch(service, /login|sign.?in|app_open|page_view/i);
  assert.match(card, /opening the app alone never counts/);
});

test("study days and streaks are Baghdad-calendar based and missing days are non-punitive", () => {
  assert.match(service, /Asia\/Baghdad/);
  assert.match(service, /activeKeys\.has\(today\).*activeKeys\.has\(yesterday\)/s);
  assert.match(card, /Missing a day never removes points or creates a penalty/);
});

test("Phase 10 provides a 365-day heatmap and current/longest streak metrics", () => {
  assert.match(service, /STUDY_STREAK_HISTORY_DAYS = 365/);
  assert.match(service, /currentStreakDays/);
  assert.match(service, /longestStreakDays/);
  assert.match(card, /g-heatmap-grid/);
  assert.match(css, /grid-template-rows:\s*repeat\(7, 11px\)/);
  assert.match(css, /intensity-4/);
});

test("the Study Streak endpoint is private, no-store and mounted under authenticated API", () => {
  assert.match(route, /\/me\/study-streak/);
  assert.match(route, /dependencies\.requireUser/);
  assert.match(route, /no-store, private, max-age=0/);
  assert.match(server, /createStudyStreakRouter/);
});

test("Study Engagement Overview loads streak independently without taking down existing overview", () => {
  assert.match(frontend, /gamificationApi\.studyStreak\(\)/);
  assert.match(frontend, /StudyStreakCard data=\{studyStreak\}/);
  assert.match(frontend, /studyStreakError/);
  assert.match(frontend, /visibilitychange/);
});

test("Phase 10 does not introduce point caps or scoring limits", () => {
  for (const marker of phase9Files) assert.doesNotMatch(service, new RegExp(marker, "i"));
  assert.match(service, /This is not a reward, cap, or eligibility rule/);
});
