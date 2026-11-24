import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseOwnLeaderboardD1Entry } from "../server/features/leaderboard/cacheReads.js";

const source = readFileSync(new URL("../server/features/leaderboard/cacheReads.ts", import.meta.url), "utf8");

test("Phase 7.5B: zero-point own rank accepts SQLite snake_case fields", () => {
  const result = parseOwnLeaderboardD1Entry({
    user_id: "user-123", rank: 42, tie_size: 8, score: 0, level_snapshot: null,
  }, "user-123");
  assert.deepEqual(result, {
    userId: "user-123", rank: 42, tieSize: 8, score: 0, levelSnapshot: null,
  });
});

test("Phase 7.5B: own-rank row cannot belong to another user", () => {
  assert.throws(() => parseOwnLeaderboardD1Entry({
    user_id: "another-user", rank: 1, tie_size: 1, score: 50,
  }, "viewer"), /does not belong to the authenticated viewer/u);
});

test("Phase 7.5B: reject negative, fractional, and malformed D1 rank rows", () => {
  for (const row of [
    { user_id: "viewer", rank: 1, tie_size: 1, score: -1 },
    { user_id: "viewer", rank: 0, tie_size: 1, score: 1 },
    { user_id: "viewer", rank: 1.2, tie_size: 1, score: 1 },
    { user_id: "viewer", rank: 1, tie_size: 0, score: 1 },
    { user_id: "viewer", rank: 1, tie_size: 1, score: "1" },
  ]) {
    assert.throws(() => parseOwnLeaderboardD1Entry(row, "viewer"));
  }
});

test("Phase 7.5B: null rank is parsed but handled by canonical eligibility fallback", () => {
  assert.equal(parseOwnLeaderboardD1Entry(null, "viewer"), null);
  assert.match(source, /if \(cached\.entry === null\)\s*\{\s*throw new CacheRejected/u);
});

test("Phase 7.5B: own-rank D1 branch validates pointer, freshness, ledger, roster and falls back", () => {
  const part = source.slice(source.indexOf("export async function getMyLeaderboardRankWithCache"));
  assert.match(part, /if \(!cacheIsEnabled\(\)\)\s*\{\s*recordReadSource\(input\.scope, "own_rank", "READ_CANONICAL"\);\s*return getMyLeaderboardRank/u);
  assert.match(part, /getCurrentManifest\(season\)/u);
  assert.match(part, /getOwnRankFromD1\(snapshot, input\.viewerId\)/u);
  assert.match(part, /validateManifestForSnapshot\(current, season, snapshot\)/u);
  assert.match(part, /compareManifests\(current, cached\.manifest\)/u);
  assert.match(part, /validateFreshness\(current, now\)/u);
  assert.match(part, /if \(newerLedger\)/u);
  assert.match(part, /activeCount !== snapshot\.entryCount/u);
  assert.match(part, /getBlockedUserIds\(input\.viewerId, database\)/u);
  assert.match(part, /recordReadSource\(input\.scope, "own_rank", "READ_FALLBACK", error\);\s*return getMyLeaderboardRank/u);
});

test("Phase 7.5B: hidden/disabled page entries cannot underfill a D1 page", () => {
  const page = source.slice(
    source.indexOf("export async function getLeaderboardPageWithCache"),
    source.indexOf("export async function getMyLeaderboardRankWithCache"),
  );
  assert.match(page, /page\.entries\.some\(\(entry\) => !visibleUserIds\.has\(entry\.userId\)\)/u);
  assert.match(page, /throw new CacheRejected\("VISIBILITY_FILTER", "D1 page includes accounts filtered/u);
  assert.match(page, /recordReadSource\(input\.scope, "page", "READ_FALLBACK", error\);\s*return getLeaderboardPage/u);
});
