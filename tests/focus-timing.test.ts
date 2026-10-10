import assert from "node:assert/strict";
import test from "node:test";
import { formatFocusTiming } from "../src/features/focus/api/focusTiming";

test("Focus timing logs are structured, bounded, and identify the measured outcome", () => {
  assert.equal(
    formatFocusTiming("study-to-break.first-frame", 16.7, "optimistic"),
    '[FocusTiming] {"name":"study-to-break.first-frame","durationMs":17,"outcome":"optimistic"}',
  );
  assert.equal(
    formatFocusTiming("hub.open-ready", -10, "error"),
    '[FocusTiming] {"name":"hub.open-ready","durationMs":0,"outcome":"error"}',
  );
});
