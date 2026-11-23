import assert from "node:assert/strict";
import test from "node:test";
import {
  isPublicLeaderboardScope,
  PUBLIC_LEADERBOARD_SCOPES,
  LEADERBOARD_SCOPES,
} from "../server/features/leaderboard/types.js";
import {
  getAvailableLeaderboardScopes,
  getLeaderboardSeasonWindow,
  validateSeasonKey,
} from "../server/features/leaderboard/periods.js";

test("Phase 7 public leaderboard accepts only Monthly, Semester and All Time", () => {
  assert.deepEqual([...PUBLIC_LEADERBOARD_SCOPES], ["MONTHLY", "SEMESTER", "ALL_TIME"]);
  assert.equal(isPublicLeaderboardScope("MONTHLY"), true);
  assert.equal(isPublicLeaderboardScope("SEMESTER"), true);
  assert.equal(isPublicLeaderboardScope("ALL_TIME"), true);
  assert.equal(isPublicLeaderboardScope("WEEKLY"), false);
  assert.equal(isPublicLeaderboardScope(null), false);
});

test("availability hides the retired weekly board whether a semester is active or not", () => {
  assert.deepEqual(
    getAvailableLeaderboardScopes(new Date("2026-11-22T12:00:00.000Z")),
    ["MONTHLY", "SEMESTER", "ALL_TIME"],
  );
  assert.deepEqual(
    getAvailableLeaderboardScopes(new Date("2027-07-01T12:00:00.000Z")),
    ["MONTHLY", "ALL_TIME"],
  );
  assert.deepEqual(
    getAvailableLeaderboardScopes(new Date("2026-11-22T12:00:00.000Z"), []),
    ["MONTHLY", "ALL_TIME"],
  );
});

test("historical weekly seasons remain supported internally; no database migrations", () => {
  assert.equal(LEADERBOARD_SCOPES.includes("WEEKLY"), true);
  assert.equal(validateSeasonKey("WEEKLY", "weekly:2026-10-18"), true);
  assert.equal(getLeaderboardSeasonWindow("WEEKLY", new Date("2026-10-18T12:00:00Z")).scope, "WEEKLY");
});
