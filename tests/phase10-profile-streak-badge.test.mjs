import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const profile = fs.readFileSync("src/features/profile/components/ProfileView.tsx", "utf8");
const app = fs.readFileSync("src/App.tsx", "utf8");
const cache = fs.readFileSync("src/features/gamification/studyStreakCache.ts", "utf8");

test("profile shows only compact current streak badge", () => {
  assert.match(profile, /profileStreakDays/);
  assert.match(profile, /<Flame/);
  assert.doesNotMatch(profile, /StudyStreakCard/);
  assert.doesNotMatch(profile, /longestStreakDays/);
  assert.doesNotMatch(profile, /activeDaysLast30/);
  assert.doesNotMatch(profile, /g-heatmap/);
});

test("app shell prefetches streak before the lazy Profile route is opened", () => {
  assert.match(app, /warmStudyStreakCache/);
  assert.match(app, /if \(!currentUser\?\.id\) return/);
  assert.match(app, /void warmStudyStreakCache\(currentUser\.id\)/);
});

test("profile consumes last-known cache synchronously and live cache updates", () => {
  assert.match(profile, /readStudyStreakCache\(profileUserId\)/);
  assert.match(profile, /STUDY_STREAK_CACHE_EVENT/);
  assert.match(profile, /CustomEvent<StudyStreakCacheEntry>/);
  assert.match(cache, /window\.localStorage\.setItem/);
  assert.match(cache, /gamificationApi\.studyStreak\(\)/);
});

test("profile streak remains secondary and keeps the last-known value on transient failure", () => {
  assert.match(cache, /return readStudyStreakCache\(accountId\)/);
  assert.doesNotMatch(profile, /setProfileStreakDays\(null\)/);
});
