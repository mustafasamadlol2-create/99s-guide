import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('Phase 3 video reward is fixed at +3 and MCQ set bonus is +5 at 70%/10 questions', () => {
  const rules = read('server/features/study-points/awardRules.ts');
  assert.match(rules, /LECTURE_VIDEO_COMPLETION_AMOUNT = 3/u);
  assert.match(rules, /MCQ_SET_PASS_AMOUNT = 5/u);
  assert.match(rules, /MCQ_SET_PASS_MIN_QUESTIONS = 10/u);
  assert.match(rules, /MCQ_SET_PASS_MIN_SCORE_PERCENT = 70/u);
});

test('MCQ completion is automatic at server result and full canonical set controls lecture-resource completion', () => {
  const server = read('server.ts');
  assert.match(server, /app\.post\("\/api\/mcqs\/submit"/u);
  assert.match(server, /const completedFullSet = canonicalQuestionCount > 0/u);
  assert.match(server, /summary\.ids\.size >= MCQ_SET_PASS_MIN_QUESTIONS/u);
  assert.match(server, /score >= MCQ_SET_PASS_MIN_SCORE_PERCENT/u);
  assert.match(server, /awardServerVerifiedQuizSet/u);
});

test('flashcards auto-complete only at a full deck and medium/easy are successful recall ratings', () => {
  const server = read('server.ts');
  const mastery = read('server/features/mastery/postCommitHooks.ts');
  assert.match(server, /canonicalIds\.every\(\(card\) => submittedIds\.has\(card\.id\)\)/u);
  assert.match(server, /completedLectureIds/u);
  assert.match(mastery, /case "MEDIUM":\s*case "GOOD":\s*return "GOOD"/u);
  assert.match(server, /event\.payload\.quality === "GOOD" \|\| event\.payload\.quality === "EASY"/u);
});

test('external YouTube opening cannot mark video complete', () => {
  const ui = read('src/features/lectures/components/LectureDetailView.tsx');
  const watchStart = ui.indexOf('const handleWatchVideo');
  const verifiedStart = ui.indexOf('const refreshVerifiedVideoProgress');
  assert.ok(watchStart >= 0 && verifiedStart > watchStart);
  const externalHandler = ui.slice(watchStart, verifiedStart);
  assert.doesNotMatch(externalHandler, /onUpdateProgress\(\{\s*videoCompleted:\s*true/u);
  assert.doesNotMatch(externalHandler, /videoCompletedAt/u);
});

test('video completion is server-timed, requires 80%, and creates canonical progress + points', () => {
  const service = read('server/features/video-progress/service.ts');
  const verification = read('server/features/video-progress/verification.ts');
  assert.match(verification, /VERIFIED_VIDEO_COMPLETION_RATIO = 0\.8/u);
  assert.match(verification, /previousPlayerState === "PLAYING"/u);
  assert.match(verification, /appearsToBeSeek/u);
  assert.match(service, /verifiedMilliseconds >= completionThresholdMs/u);
  assert.match(service, /completionType: "VIDEO"/u);
  assert.match(service, /videoCompletedAt: existingLectureProgress\?\.videoCompletedAt \?\? now/u);
});

test('in-app YouTube player tracks verified playback and external playback is explicitly non-scoring', () => {
  const card = read('src/features/lectures/components/VideoCard.tsx');
  assert.match(card, /\/api\/videos\/watch\/start/u);
  assert.match(card, /\/api\/videos\/watch\/heartbeat/u);
  assert.match(card, /80% verified in-app playback/u);
  assert.match(card, /External YouTube playback does not earn points/u);
});

test('video watch migration is after Phase 2 and has one progress row per user/material', () => {
  const migration = read('prisma/migrations/20261018190000_video_watch_verification/migration.sql');
  assert.match(migration, /CREATE TABLE "VideoWatchProgress"/u);
  assert.match(migration, /CREATE UNIQUE INDEX "VideoWatchProgress_userId_materialId_key"/u);
  assert.match(migration, /ON DELETE CASCADE/u);
});
