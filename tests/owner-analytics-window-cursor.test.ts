import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeOwnerAnalyticsLectureCursor,
  encodeOwnerAnalyticsLectureCursor,
  OwnerAnalyticsCursorError,
} from "../server/features/owner-analytics/cursor.js";
import {
  isOwnerAnalyticsWindowPreset,
  OwnerAnalyticsWindowError,
  resolveOwnerAnalyticsWindow,
} from "../server/features/owner-analytics/windows.js";

const AS_OF = new Date("2026-09-27T12:00:00.000Z");

test("fixed windows use Baghdad calendar midnights and server asOf", () => {
  const sevenDays = resolveOwnerAnalyticsWindow("LAST_7_DAYS", AS_OF);
  assert.equal(sevenDays.from.toISOString(), "2026-09-20T21:00:00.000Z");
  assert.equal(sevenDays.to.toISOString(), AS_OF.toISOString());
  assert.equal(sevenDays.asOf.toISOString(), AS_OF.toISOString());

  const thirtyDays = resolveOwnerAnalyticsWindow("LAST_30_DAYS", AS_OF);
  assert.equal(thirtyDays.from.toISOString(), "2026-08-28T21:00:00.000Z");
  assert.equal(thirtyDays.to.toISOString(), AS_OF.toISOString());

  const yearBoundary = resolveOwnerAnalyticsWindow(
    "LAST_7_DAYS",
    new Date("2026-01-01T12:00:00.000Z"),
  );
  assert.equal(yearBoundary.from.toISOString(), "2025-12-25T21:00:00.000Z");
});

test("only the three fixed window presets are accepted", () => {
  assert.equal(isOwnerAnalyticsWindowPreset("LAST_7_DAYS"), true);
  assert.equal(isOwnerAnalyticsWindowPreset("LAST_30_DAYS"), true);
  assert.equal(isOwnerAnalyticsWindowPreset("CURRENT_SEMESTER"), true);
  assert.equal(isOwnerAnalyticsWindowPreset("LAST_14_DAYS"), false);
  assert.equal(isOwnerAnalyticsWindowPreset(undefined), false);
});

test("current semester fails explicitly when no canonical boundaries exist", () => {
  assert.throws(
    () => resolveOwnerAnalyticsWindow("CURRENT_SEMESTER", AS_OF),
    (error: unknown) =>
      error instanceof OwnerAnalyticsWindowError
      && error.code === "SEMESTER_CONFIGURATION_UNAVAILABLE",
  );
});

test("lecture cursors round-trip only canonical content-order state", () => {
  const cursor = {
    subjectId: "cardiology",
    lectureId: "00000000-0000-4000-8000-000000000001",
  };
  const encoded = encodeOwnerAnalyticsLectureCursor(cursor);
  assert.deepEqual(decodeOwnerAnalyticsLectureCursor(encoded), cursor);
  assert.throws(
    () => encodeOwnerAnalyticsLectureCursor({
      ...cursor,
      lectureId: "student-42",
    }),
    OwnerAnalyticsCursorError,
  );
});

test("malformed and expanded cursors are rejected", () => {
  for (const cursor of [
    "",
    "not-a-cursor",
    Buffer.from(JSON.stringify({
      version: 1,
      subjectId: "cardiology",
      lectureId: "00000000-0000-4000-8000-000000000001",
      userId: "student",
    })).toString("base64url"),
  ]) {
    assert.throws(() => decodeOwnerAnalyticsLectureCursor(cursor), OwnerAnalyticsCursorError);
  }
});