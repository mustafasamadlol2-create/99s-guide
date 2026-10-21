import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Phase 11 Today service is Baghdad-local, canonical-derived and uncapped", () => {
  const service = read("server/features/today-study/service.ts");
  assert.match(service, /TODAY_STUDY_TIME_ZONE = "Asia\/Baghdad"/u);
  assert.match(service, /studyDailyMetric\.findUnique/u);
  assert.match(service, /studyEvent\.findMany/u);
  assert.match(service, /groupFocusParticipantSummary\.findMany/u);
  assert.match(service, /videoWatchProgress\.count/u);
  assert.match(service, /studyPointsLedgerEntry\.aggregate/u);
  assert.match(service, /createdAt: \{ gte: startAt, lt: resetAt \}/u);
  assert.doesNotMatch(service, /100(?:\s*)points|daily cap|category cap/iu);
});

test("Phase 11 endpoint is authenticated and explicitly no-store", () => {
  const route = read("server/routes/todayStudy.ts");
  const server = read("server.ts");
  assert.match(route, /router\.get\("\/me\/today-study", dependencies\.requireUser/u);
  assert.match(route, /no-store, private, max-age=0, must-revalidate/u);
  assert.match(server, /createTodayStudyRouter\(\{ requireUser \}\)/u);
});

test("Profile contains one fixed Today card with exactly the agreed six study metrics", () => {
  const card = read("src/features/profile/components/TodayStudyCard.tsx");
  const profile = read("src/features/profile/components/ProfileView.tsx");
  for (const token of ["focusSeconds", "lecturesCompleted", "mcqAttempts", "flashcardReviews", "videosCompleted", "pointsEarned"]) {
    assert.match(card, new RegExp(token, "u"));
  }
  assert.match(profile, /<TodayStudyCard language=\{language\} summary=\{todayStudy\}/u);
  assert.doesNotMatch(card, /share|notification|popup|modal/iu);
});

test("Today card is prefetched, realtime-refreshed and resets at Baghdad midnight", () => {
  const app = read("src/App.tsx");
  const cache = read("src/features/profile/todayStudyCache.ts");
  assert.match(app, /warmTodayStudyCache\(accountId\)/u);
  assert.match(app, /GAMIFICATION_INVALIDATED_EVENT/u);
  assert.match(app, /GAMIFICATION_OPTIMISTIC_POINTS_EVENT/u);
  assert.match(app, /millisecondsUntilNextBaghdadMidnight\(\)/u);
  assert.match(cache, /cache: "no-store"/u);
  assert.match(cache, /summary\.date !== currentBaghdadDateKey\(\)/u);
});
