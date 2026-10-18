import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('MCQ and flashcard rewards use the MASTERY category', () => {
  const rules = read('server/features/study-points/awardRules.ts');
  assert.match(rules, /ruleVersion: "mcq-first-correct-v2",\s*category: "MASTERY"/u);
  assert.match(rules, /ruleVersion: "flashcard-first-recall-v2",\s*category: "MASTERY"/u);
  assert.match(rules, /ruleVersion: "mcq-set-pass-v2",\s*category: "MASTERY"/u);
});


test('old short-lived PROGRESS learning rows are canonically remapped to MASTERY for balances', () => {
  const balance = read('server/features/study-points/balanceProjection.ts');
  const caps = read('server/features/study-points/caps.ts');
  for (const source of [balance, caps]) {
    assert.match(source, /mcq\.first_verified_correct/u);
    assert.match(source, /flashcard\.first_verified_recall/u);
    assert.match(source, /mcq\.set_verified_pass/u);
    assert.match(source, /THEN 'MASTERY'/u);
  }
});
test('old Phase 3 learning awards remain one-time after the category correction', () => {
  const engine = read('server/features/study-points/awardEngine.ts');
  assert.match(engine, /mcq-first-correct-v1/u);
  assert.match(engine, /flashcard-first-recall-v1/u);
  assert.match(engine, /mcq-set-pass-v1/u);
  assert.match(engine, /replayed: true/u);
});

test('MCQ and flashcard response path no longer waits on mastery projections', () => {
  const server = read('server.ts');
  assert.match(server, /void recordMasteryStudyEventsAndRefreshBestEffort\(\{\s*userId,/u);
  assert.match(server, /void recordMasteryStudyEventsAndRefreshBestEffort\(\{\s*userId: \(req as any\)\.user\.id,/u);
});

test('flashcard ratings are persisted per tap and deck completion remains a recovery/finalization path', () => {
  const ui = read('src/features/lectures/components/LectureDetailView.tsx');
  assert.match(ui, /persistFlashcardRating/u);
  assert.match(ui, /completionCheck: false/u);
  assert.match(ui, /void persistFlashcardRating\(cardId, rating\)/u);
  const server = read('server.ts');
  assert.match(server, /const completionCheck = req\.body\?\.completionCheck !== false/u);
});

test('leaderboard can identify and immediately overlay the viewer score', () => {
  const serverTypes = read('server/features/leaderboard/types.ts');
  const serverQuery = read('server/features/leaderboard/queries.ts');
  const ui = read('src/features/gamification/LeaderboardView.tsx');
  assert.match(serverTypes, /isViewer: boolean/u);
  assert.match(serverQuery, /isViewer: row\.userId === input\.viewerId/u);
  assert.match(ui, /entry\.isViewer/u);
  assert.match(ui, /optimisticPointDelta/u);
});

test('video sends an immediate authoritative heartbeat when playback crosses 80 percent', () => {
  const card = read('src/features/lectures/components/VideoCard.tsx');
  assert.match(card, /position \/ duration >= 0\.8/u);
  assert.match(card, /void sendHeartbeat\("PLAYING"\)/u);
  assert.ok(card.includes('}, 400);'));
});


test('Points V2 has no daily, category, activity, weekly, or total caps', () => {
  const engine = read('server/features/study-points/awardEngine.ts');
  const rules = read('server/features/study-points/awardRules.ts');
  const caps = read('server/features/study-points/caps.ts');
  const audit = read('server/features/study-points/accountingAudit.ts');
  assert.match(engine, /pointsLimitMode: "UNLIMITED"/u);
  assert.doesNotMatch(engine, /STUDY_POINTS_TOTAL_DAILY_CAP/u);
  assert.doesNotMatch(engine, /STUDY_POINTS_CATEGORY_DAILY_CAPS/u);
  assert.doesNotMatch(rules, /MAX_POINTS_PER_DAY/u);
  assert.doesNotMatch(rules, /MAX_POINTS_PER_WEEK/u);
  assert.doesNotMatch(rules, /MAX_AWARDS_PER_DAY/u);
  assert.doesNotMatch(caps, /STUDY_POINTS_TOTAL_DAILY_CAP/u);
  assert.doesNotMatch(caps, /STUDY_POINTS_CATEGORY_DAILY_CAPS/u);
  assert.doesNotMatch(audit, /CAP_EXCEEDED/u);
});
