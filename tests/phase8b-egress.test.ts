import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { normalizeCompactProgress, syncCompactProgress } from "../server/services/compactProgressSync.ts";
import { AcademicRefresh, watchVisibleAcademicRefresh, type AcademicRead } from "../src/core/calendar/AcademicRefresh.ts";
import { filterAcademicCalendarForAccount } from "../src/core/calendar/academicEvents.ts";
import { matchesSubmittedProgress } from "../src/core/offline/reconcilePendingProgress.ts";
import type { CalendarEvent } from "../src/core/types.ts";

test("startup, foreground, focus, and reconnect re-use one compatible read per resource", async () => {
  let now = 0;
  const refresh = new AcademicRefresh(() => now);
  refresh.setScope("account A, group A");
  let reads = 0;
  const load = async () => { reads++; return true; };
  const initial = refresh.refresh("calendar", "restore", load);
  assert.equal(refresh.refresh("calendar", "revalidate", load), initial);
  assert.equal(refresh.refresh("calendar", "restore", load), initial);
  await initial;
  await refresh.refresh("calendar", "revalidate", load);
  now = 10_000;
  await refresh.refresh("calendar", "restore", load);
  assert.equal(reads, 1);
  now = 15_000;
  await refresh.refresh("calendar", "revalidate", load);
  assert.equal(reads, 2);
});

test("in-flight content invalidations suppress stale results and schedule one follow-up", async () => {
  const refresh = new AcademicRefresh();
  refresh.setScope("same account");
  let finish!: () => void;
  let staleRead!: AcademicRead;
  const first = refresh.refresh("lectures", "restore", async (read) => {
    staleRead = read;
    await new Promise<void>((resolve) => { finish = resolve; });
    return true;
  });
  await Promise.resolve();
  assert.ok(refresh.isReading("lectures"));
  let followUps = 0;
  const updated = async (read: AcademicRead) => {
    followUps++;
    assert.ok(read.isCurrent());
    assert.notEqual(read.requestKey, staleRead.requestKey);
    return true;
  };
  const second = refresh.refresh("lectures", "invalidate", updated);
  assert.equal(refresh.refresh("lectures", "invalidate", updated), second);
  assert.equal(staleRead.isCurrent(), false);
  finish();
  await Promise.all([first, second]);
  assert.equal(followUps, 1);
});

test("offline restores and failed Worker reads leave room for immediate retry; scope changes isolate reads", async () => {
  const refresh = new AcademicRefresh(() => 0);
  refresh.setScope("account A, group A");
  let old!: AcademicRead;
  await refresh.refresh("materials", "restore", async (read) => { old = read; return false; });
  let attempted = 0;
  await refresh.refresh("materials", "revalidate", async () => { attempted++; throw new Error("Worker unavailable"); });
  await refresh.refresh("materials", "revalidate", async () => { attempted++; return true; });
  assert.equal(attempted, 2);
  refresh.setScope(null);
  assert.ok(old.signal.aborted);
  refresh.setScope("account B, group B");
  await refresh.refresh("materials", "revalidate", async (read) => {
    assert.notEqual(read.requestKey, old.requestKey);
    assert.ok(read.isCurrent());
    attempted++;
    return true;
  });
  assert.equal(attempted, 3);
});

test("hidden tabs make no academic timer or focus requests and repeated visibility events keep one chain", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  const view = new EventTarget();
  let requests = 0;
  const stop = watchVisibleAcademicRefresh(() => { requests++; }, page, view);
  page.visibilityState = "hidden";
  page.dispatchEvent(new Event("visibilitychange"));
  view.dispatchEvent(new Event("focus"));
  t.mock.timers.tick(360_000);
  assert.equal(requests, 0);
  page.visibilityState = "visible";
  page.dispatchEvent(new Event("visibilitychange"));
  page.dispatchEvent(new Event("visibilitychange"));
  const restored = requests;
  t.mock.timers.tick(180_000);
  assert.equal(requests, restored + 1);
  stop();
  t.mock.timers.tick(360_000);
  assert.equal(requests, restored + 1);
});

test("offline schedules hide personal rows and other groups after account or group changes", () => {
  const events = [
    { id: "everyone", targetGroups: ["ALL"] },
    { id: "a", targetGroups: ["A"] },
    { id: "b", targetGroups: [" b "] },
    { id: "personal", targetGroups: ["ALL"], userId: "other-account" },
  ] as CalendarEvent[];
  const visible = (role: "user" | "owner", studentGroup: string) =>
    filterAcademicCalendarForAccount(events, { role, studentGroup }).map((row) => row.id);
  assert.deepEqual(visible("user", "A"), ["everyone", "a"]);
  assert.deepEqual(visible("user", "B"), ["everyone", "b"]);
  assert.deepEqual(visible("owner", "B"), ["everyone", "a", "b"]);
  assert.deepEqual(filterAcademicCalendarForAccount(events, null), []);
});

test("an old success, deletion, or rejection cannot overwrite a newer pending offline edit", () => {
  const sent = { id: "lecture-a", userId: "self", synced: 0, lastUpdated: "yesterday", payload: { notesCompleted: true } };
  assert.equal(matchesSubmittedProgress({ ...sent }, sent), true);
  assert.equal(matchesSubmittedProgress({ ...sent, lastUpdated: "today" }, sent), false);
  assert.equal(matchesSubmittedProgress({ ...sent, payload: { notesCompleted: true, pdfCompleted: true } }, sent), false);
  assert.equal(matchesSubmittedProgress({ ...sent, userId: "other" }, sent), false);
  assert.equal(matchesSubmittedProgress({ ...sent, synced: 1 }, sent), false);
});

test("compact progress merges duplicate completion flags and bounds implausible timestamps", () => {
  const now = new Date("2026-11-26T15:00:00Z");
  const [progress] = normalizeCompactProgress([
    { lectureId: " lecture ", pdfCompleted: true, quizCompleted: true, quizScore: 80, lastAccessed: now.toISOString() },
    { lectureId: "lecture", videoCompleted: true, quizCompleted: true, quizScore: 20, lastAccessed: "2026-11-25T15:00:00Z" },
    { lectureId: "lecture", notesCompleted: true, lastAccessed: "2099-11-26T15:00:00Z" },
    { lectureId: " " },
  ], now);
  assert.deepEqual(progress, {
    lectureId: "lecture", pdfCompleted: true, notesCompleted: true, videoCompleted: true,
    flashcardsCompleted: false, quizCompleted: true, quizScore: 80, lastAccessed: now,
  });
});

test("compact progress has one canonical statement with bounded output and prunes confirmed missing IDs", async () => {
  const queries: string[] = [];
  const database = {
    async $queryRaw(parts: TemplateStringsArray) {
      queries.push(parts.join("?"));
      return [{ userId: "student", lectureId: "present", quizScore: null }];
    },
  } as unknown as Pick<PrismaClient, "$queryRaw">;
  const result = await syncCompactProgress(database, "student", [
    { lectureId: "present", pdfCompleted: true }, { lectureId: "deleted" },
  ]);
  assert.deepEqual(result.prunedLectureIds, ["deleted"]);
  assert.equal(result.progress[0].quizScore, 0);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /JOIN "Lecture"[\s\S]*ON CONFLICT \("userId", "lectureId"\)/);
  assert.match(queries[0], /existing\."pdfCompleted" OR EXCLUDED\."pdfCompleted"/);
  assert.doesNotMatch(queries[0], /RETURNING\s+\*|CompletedAt|StudyPoints|CalendarEvent/);
  assert.deepEqual(await syncCompactProgress(database, "student", []), { progress: [], prunedLectureIds: [] });
  assert.equal(queries.length, 1);
});


const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("runtime wiring preserves old clients, canonical auth, group visibility, and queued mutations", () => {
  const server = read("server.ts");
  assert.match(server, /app\.post\("\/api\/auth\/sync", requireUser[\s\S]*?req\.query\.mode === "progress"[\s\S]*?authUser\.id !== userId[\s\S]*?syncCompactProgress[\s\S]*?UserService\.getFullUserData[\s\S]*?globalMaterials:/);
  assert.match(server, /app\.post\("\/api\/offline\/reconcile", requireUser[\s\S]*?item\.userId !== authUser\.id[\s\S]*?LEFT JOIN "LectureProgress"[\s\S]*?discarded: true/);
  assert.match(server, /io\.to\(audience\)\.emit\("calendar_updated"[\s\S]*?except\(audience\)\.emit\("calendar_updated", \{ action: "delete"/);
  const engine = read("src/core/offline/OfflineEngine.ts");
  assert.match(engine, /progress\?\.length > 2000 \? "\/api\/auth\/sync" : "\/api\/auth\/sync\?mode=progress"/);
  assert.match(engine, /const unattempted = this\.getMutationQueue\(\)\.filter/);
  const sync = read("src/core/offline/DataSyncManager.ts");
  assert.match(sync, /Array\.isArray\(data\?\.flashcards\)[\s\S]*?Array\.isArray\(data\.mcqs\)[\s\S]*?db\.transaction\(\["flashcards", "mcqs"\]/);
  assert.match(sync, /matchesSubmittedProgress\(request\.result, sent\)[\s\S]*?store\.delete\(sent\.id\)/);
});

test("verified playback keeps the five-second cadence and emits one optional near-completion probe per server session", () => {
  const card = read("src/features/lectures/components/VideoCard.tsx");
  assert.match(card, /void sendHeartbeat\("PLAYING"\);\s*\}, 5_000\)/);
  assert.match(card, /completionProbeSessionRef\.current === sessionId[\s\S]*?position \/ duration >= 0\.8[\s\S]*?completionProbeSessionRef\.current = sessionId[\s\S]*?void sendHeartbeat\("PLAYING"\)/);
  assert.match(card, /status\?: number.*?status === 409[\s\S]*?await startVerification\(duration\)/);
  const service = read("server/features/video-progress/service.ts");
  assert.match(service, /select: \{[\s\S]*?lastHeartbeatAt: true, lastPlayerState: true, lastPlaybackRate: true/);
  assert.match(service, /calculateVerifiedPlaybackCredit\(/);
  assert.match(service, /awardServerVerifiedLectureProgress\(/);
});
