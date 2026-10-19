import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Focus lifecycle treats the private D1 session projection as rebuildable", () => {
  const source = read("server/features/focus/service.ts");
  assert.match(source, /const FOCUS_SESSION_PROJECTION_SAVEPOINT = "focus_session_projection_enqueue"/u);
  assert.match(source, /ROLLBACK TO SAVEPOINT \$\{FOCUS_SESSION_PROJECTION_SAVEPOINT\}/u);
  assert.match(source, /Session projection enqueue deferred/u);
  const bestEffortCalls = source.match(/await enqueueSessionProjectionBestEffort\(tx, (?:created|session|updated)\);/gu) ?? [];
  assert.equal(bestEffortCalls.length, 10);
  const strictCalls = source.match(/await enqueueSessionProjection\(tx, session\);/gu) ?? [];
  assert.equal(strictCalls.length, 1, "strict projection enqueue should only exist inside the savepoint wrapper");
});

test("FocusSession outbox SQL is isolated from unrelated projection tables", () => {
  const source = read("server/services/privateD1Sync.ts");
  const start = source.indexOf('} else if (input.entity === "FocusSession") {');
  const end = source.indexOf('} else if (input.entity === "StudyDailyMetric") {', start);
  assert.ok(start >= 0 && end > start);
  const focusBranch = source.slice(start, end);
  assert.match(focusBranch, /INSERT INTO "PrivateD1SyncOutbox"/u);
  assert.match(focusBranch, /UPDATE "FocusSession" AS session/u);
  assert.doesNotMatch(focusBranch, /MasteryD1ProjectionState/u);
  assert.doesNotMatch(focusBranch, /UPDATE "StudyDailyMetric"/u);
});

test("Weekly leaderboard is Sunday-to-Saturday in Baghdad with a collision-free key", () => {
  const source = read("server/features/leaderboard/periods.ts");
  assert.match(source, /const sunday = addCalendarDays\(localDate, -weekday\);/u);
  assert.match(source, /const nextSunday = addCalendarDays\(sunday, 7\);/u);
  assert.match(source, /seasonKey: weeklySundayKey\(sunday\)/u);
  assert.match(source, /weekly:\$\{String\(sunday\.year\)/u);
  assert.match(source, /Keep legacy ISO-Monday keys readable/u);
});
