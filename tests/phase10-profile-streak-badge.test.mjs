import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const profile = fs.readFileSync("src/features/profile/components/ProfileView.tsx", "utf8");

test("profile shows only compact current streak badge", () => {
  assert.match(profile, /gamificationApi\.studyStreak\(\)/);
  assert.match(profile, /profileStreakDays/);
  assert.match(profile, /<Flame/);
  assert.doesNotMatch(profile, /StudyStreakCard/);
  assert.doesNotMatch(profile, /longestStreakDays/);
  assert.doesNotMatch(profile, /activeDaysLast30/);
  assert.doesNotMatch(profile, /g-heatmap/);
});

test("profile streak refreshes when profile becomes active and app returns", () => {
  assert.match(profile, /if \(!isActive\) return/);
  assert.match(profile, /window\.addEventListener\("focus"/);
  assert.match(profile, /document\.addEventListener\("visibilitychange"/);
});

test("profile streak remains secondary and fails silently", () => {
  assert.match(profile, /setProfileStreakDays\(null\)/);
  assert.match(profile, /transient analytics read/);
});
