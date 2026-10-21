import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const service = fs.readFileSync("server/features/study-streak/service.ts", "utf8");

test("streak uses server commit timestamps, not historical effective timestamps", () => {
  assert.match(service, /createdAt: \{ gte: instantStart, lte: asOf \}/);
  assert.match(service, /const date = getBaghdadMetricDate\(row\.createdAt\)/);
  assert.match(service, /receivedAt: \{ gte: instantStart, lte: asOf \}/);
  assert.match(service, /const date = getBaghdadMetricDate\(row\.receivedAt\)/);
});

test("one failing optional source cannot collapse the whole streak endpoint", () => {
  assert.match(service, /Promise\.allSettled/);
  assert.match(service, /reads\.every\(\(read\) => read\.status === "rejected"\)/);
});

test("server-derived verified activity is accepted", () => {
  assert.match(service, /"SERVER_DERIVED"/);
  assert.match(service, /activityRuleVersion: "study-day-v3"/);
});
