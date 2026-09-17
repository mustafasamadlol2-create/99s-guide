import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_NOTE_MATERIALS,
  NoteLimitReachedError,
  noteLimitResponse,
  sortNoteMaterials,
} from "../server/services/materialNotePolicy.ts";

test("keeps NOTE capacity at ten and returns a stable limit payload", () => {
  assert.equal(MAX_NOTE_MATERIALS, 10);
  assert.deepEqual(noteLimitResponse(10), {
    error: "This lecture already has the maximum of 10 notes.",
    code: "NOTE_LIMIT_REACHED",
    max: 10,
    currentCount: 10,
    remaining: 0,
  });
});

test("rejects an eleventh NOTE without changing the existing collection", () => {
  const existing = Array.from({ length: 10 }, (_, index) => ({
    id: `note-${index + 1}`,
    title: `Note ${index + 1}`,
  }));
  const before = [...existing];

  assert.throws(
    () => {
      if (existing.length >= MAX_NOTE_MATERIALS) {
        throw new NoteLimitReachedError(existing.length);
      }
      existing.push({ id: "note-11", title: "Note 11" });
    },
    (error: unknown) => error instanceof NoteLimitReachedError
      && error.code === "NOTE_LIMIT_REACHED"
      && error.currentCount === 10,
  );
  assert.deepEqual(existing, before);
});

test("orders NOTE materials by creation time with an ID fallback", () => {
  const ordered = sortNoteMaterials([
    { id: "b", createdAt: "2026-09-18T10:00:00.000Z" },
    { id: "c", createdAt: "2026-09-18T09:00:00.000Z" },
    { id: "a", createdAt: "2026-09-18T10:00:00.000Z" },
  ]);

  assert.deepEqual(ordered.map((material) => material.id), ["c", "a", "b"]);
});