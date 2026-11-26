import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const service = fs.readFileSync("server/features/study-streak/service.ts", "utf8");

test("streak uses server commit timestamps, not historical effective timestamps", () => {
  for (const timestamp of ["createdAt", "receivedAt"]) {
    assert.ok(service.includes('"' + timestamp + '" BETWEEN ${fromUtc} AND ${throughUtc}'));
    assert.ok(service.includes('to_char(("' + timestamp + '" AT TIME ZONE \'UTC\') AT TIME ZONE ${STUDY_STREAK_TIME_ZONE}'));
  }
  assert.match(service, /const fromUtc = Prisma\.sql.*instantStart/);
  assert.match(service, /const throughUtc = Prisma\.sql.*asOf/);
  assert.doesNotMatch(service, /"(?:effectiveAt|occurredAt)" (?:AT TIME ZONE|BETWEEN)/);
});

test("one failing optional source cannot collapse the whole streak endpoint", () => {
  assert.match(service, /Promise\.allSettled/);
  assert.match(service, /reads\.every\(\(read\) => read\.status === "rejected"\)/);
});

test("server-derived verified activity is accepted", () => {
  assert.match(service, /"SERVER_DERIVED"/);
  assert.match(service, /activityRuleVersion: "study-day-v3"/);
});
