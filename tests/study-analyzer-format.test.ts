import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBaghdadDate,
  formatDuration,
  formatNumber,
  formatRateBps,
  trendLabel,
} from "../src/features/study-analyzer/format.js";

test("unknown values stay distinct from measured zero", () => {
  assert.equal(formatNumber(null, "en"), "—");
  assert.equal(formatNumber(undefined, "en"), "—");
  assert.equal(formatNumber(0, "en"), "0");
  assert.equal(formatRateBps(null, "en"), "—");
  assert.equal(formatRateBps(0, "en"), "0%");
});

test("display formatting rounds percentages without false precision", () => {
  assert.equal(formatRateBps(7_238, "en"), "72%");
  assert.equal(formatRateBps(7_250, "en"), "73%");
});

test("durations use compact localized hours and minutes", () => {
  assert.equal(formatDuration(8_100, "en"), "2 h 15 min");
  assert.equal(formatDuration(3_600, "en"), "1 h");
  assert.equal(formatDuration(2_700, "en"), "45 min");
  assert.equal(formatDuration(null, "en"), "—");
});

test("dates are formatted in Baghdad time", () => {
  assert.match(formatBaghdadDate("2026-09-29T21:30:00.000Z", "en"), /30 Sept 2026/u);
});

test("trend labels preserve the server classification", () => {
  assert.equal(trendLabel("IMPROVED", "en"), "Improving");
  assert.equal(trendLabel("DECLINED", "en"), "Declining");
  assert.equal(trendLabel("INSUFFICIENT_DATA", "ar"), "لا توجد بيانات كافية");
});