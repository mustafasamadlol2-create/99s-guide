import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("server/features/study-streak/service.ts", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const profile = readFileSync("src/features/profile/components/ProfileView.tsx", "utf8");
const engagement = readFileSync("src/features/gamification/GamificationFrontend.tsx", "utf8");

test("streak day uses canonical verified events and positive Points V2 activity, not only the daily projection", () => {
  assert.match(service, /ACTIVE_STUDY_EVENT_TYPES/);
  assert.match(service, /studyPointsLedgerEntry\.findMany/);
  assert.match(service, /amount:\s*\{\s*gt:\s*0\s*\}/);
  assert.match(service, /canonicalActivityDates/);
  assert.match(service, /activityRuleVersion:\s*"study-day-v3"/);
});

test("first verified study activity makes today active immediately and never increments days client-side", () => {
  assert.match(service, /activeToday:\s*activeKeys\.has\(today\)/);
  assert.match(app, /warmStudyStreakCache\(currentUser\.id\)/);
  assert.match(app, /GAMIFICATION_OPTIMISTIC_POINTS_EVENT/);
  assert.match(app, /GAMIFICATION_INVALIDATED_EVENT/);
  assert.doesNotMatch(app, /currentStreakDays\s*\+\s*1/);
});

test("profile and Study Engagement share the refreshed canonical cache", () => {
  assert.match(profile, /STUDY_STREAK_CACHE_EVENT/);
  assert.match(profile, /GAMIFICATION_INVALIDATED_EVENT/);
  assert.match(engagement, /writeStudyStreakCache\(account, result\.currentStreakDays\)/);
});
