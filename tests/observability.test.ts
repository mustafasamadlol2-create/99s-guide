import assert from "node:assert/strict";
import test from "node:test";
import {
  clearOperationalMetricsForTests,
  getOperationalMetricsSnapshot,
  recordHttpRequest,
  recordOperationalOutcome,
  routeFamilyForPath,
} from "../server/observability/metrics.js";
import { redactLogValue, redactText } from "../server/observability/redaction.js";

test("request paths are reduced to low-cardinality route families", () => {
  assert.equal(routeFamilyForPath("/api/study-points/ledger/private-student-id"), "STUDY_POINTS");
  assert.equal(routeFamilyForPath("/api/focus/sessions/room-secret"), "FOCUS");
  assert.equal(routeFamilyForPath("/api/unclassified/private-student-id"), "GENERAL");
});

test("operational metrics aggregate response classes without storing request identity", () => {
  clearOperationalMetricsForTests();
  recordHttpRequest({ routeFamily: "STUDY_POINTS", statusCode: 200, durationMs: 12 });
  recordHttpRequest({ routeFamily: "STUDY_POINTS", statusCode: 503, durationMs: 30 });
  const snapshot = getOperationalMetricsSnapshot();
  const points = snapshot.byFeature.find((item) => item.feature === "STUDY_POINTS");
  assert.equal(points?.requests, 2);
  assert.equal(points?.serverErrors, 1);
  assert.equal(snapshot.serverErrors, 1);
  assert.ok(snapshot.latencyMs.p95 !== null && snapshot.latencyMs.p95 >= 12);
  const errorCountBeforeExpectedOutcomes = snapshot.recentErrors.length;
  recordOperationalOutcome({ feature: "recall", operation: "request", result: "cooldown" });
  recordOperationalOutcome({ feature: "recall", operation: "request", result: "no_eligible" });
  recordOperationalOutcome({ feature: "ai_insights", operation: "provider", result: "cache_hit" });
  recordOperationalOutcome({ feature: "ask_study_data", operation: "request", result: "unsupported" });
  const afterOutcomes = getOperationalMetricsSnapshot();
  assert.equal(afterOutcomes.recentErrors.length, errorCountBeforeExpectedOutcomes);
  assert.deepEqual(
    afterOutcomes.outcomes.map((outcome) => outcome.result).sort(),
    ["cache_hit", "cooldown", "no_eligible", "unsupported"],
  );
  clearOperationalMetricsForTests();
});

test("log redaction removes common personal values and sensitive object fields", () => {
  const privateText = "student@example.com Bearer abcdefghijklmnopqrstuvwxyz0123456789";
  const textResult = redactText(privateText);
  assert.equal(textResult.includes("student@example.com"), false);
  assert.equal(textResult.includes("abcdefghijklmnopqrstuvwxyz0123456789"), false);

  const structured = redactLogValue({
    userId: "student-record-identifier",
    ip: "192.0.2.10",
    email: "student@example.com",
    details: { password: "secret-value", message: privateText },
  });
  const serialized = JSON.stringify(structured);
  for (const sensitive of [
    "student-record-identifier",
    "192.0.2.10",
    "student@example.com",
    "secret-value",
    "abcdefghijklmnopqrstuvwxyz0123456789",
  ]) {
    assert.equal(serialized.includes(sensitive), false);
  }
});