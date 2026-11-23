import assert from 'node:assert/strict';
import test from 'node:test';
import { compareLeaderboardRows } from '../scripts/phase7-leaderboard-row-parity.js';

const rows = [
  { userId: 'a', rank: 1, tieSize: 1, score: 50n, levelSnapshot: 2 },
  { userId: 'b', rank: 2, tieSize: 2, score: 0n, levelSnapshot: null },
  { userId: 'c', rank: 2, tieSize: 2, score: 0n, levelSnapshot: null },
];

test('Phase7.3 row parity: 0-point ties and bigint scores are equivalent', () => {
  const result = compareLeaderboardRows(rows, [
    { userId: 'b', rank: 2, tieSize: 2, score: 0, levelSnapshot: null },
    { userId: 'c', rank: 2, tieSize: 2, score: 0, levelSnapshot: null },
    { userId: 'a', rank: 1, tieSize: 1, score: 50, levelSnapshot: 2 },
  ]);
  assert.equal(result.passed, true);
});

test('Phase7.3 row parity: detects wrong scores, ranks and levels', () => {
  const result = compareLeaderboardRows(rows, [
    { userId: 'a', rank: 3, tieSize: 1, score: 60, levelSnapshot: 4 },
    { userId: 'b', rank: 2, tieSize: 2, score: 0, levelSnapshot: null },
    { userId: 'c', rank: 2, tieSize: 2, score: 0, levelSnapshot: null },
  ]);
  assert.equal(result.passed, false);
  assert.equal(result.changedScore, 1);
  assert.equal(result.changedRank, 1);
  assert.equal(result.changedLevel, 1);
});

test('Phase7.3 row parity: detects dropped, unexpected and duplicate rows', () => {
  const result = compareLeaderboardRows(rows, [
    { userId: 'a', rank: 1, tieSize: 1, score: 50, levelSnapshot: 2 },
    { userId: 'a', rank: 1, tieSize: 1, score: 50, levelSnapshot: 2 },
    { userId: 'x', rank: 4, tieSize: 1, score: 3, levelSnapshot: null },
  ]);
  assert.equal(result.passed, false);
  assert.equal(result.missing, 2);
  assert.equal(result.extra, 1);
  assert.equal(result.duplicate, 1);
});

test('Phase7.3 row parity: rejects invalid or unsafe replica scores', () => {
  assert.throws(() => compareLeaderboardRows([], [
    { userId: 'a', rank: 1, tieSize: 1, score: -1, levelSnapshot: null },
  ]));
});
