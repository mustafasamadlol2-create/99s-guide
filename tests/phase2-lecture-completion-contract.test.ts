import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  LECTURE_COMPLETION_AMOUNT,
  LECTURE_COMPLETION_RULE,
  LECTURE_NOTES_COMPLETION_AMOUNT,
  LECTURE_NOTES_COMPLETION_RULE,
  LECTURE_PDF_COMPLETION_AMOUNT,
  LECTURE_PDF_COMPLETION_RULE,
} from "../server/features/study-points/awardRules.js";
import { STUDY_POINTS_SOURCE_TYPES } from "../server/features/study-points/constants.js";

test("Phase 2 completion reward values and sources are stable", () => {
  assert.equal(LECTURE_PDF_COMPLETION_AMOUNT, 5);
  assert.equal(LECTURE_NOTES_COMPLETION_AMOUNT, 3);
  assert.equal(LECTURE_COMPLETION_AMOUNT, 8);
  assert.deepEqual(
    [
      LECTURE_PDF_COMPLETION_RULE.sourceType,
      LECTURE_NOTES_COMPLETION_RULE.sourceType,
      LECTURE_COMPLETION_RULE.sourceType,
    ],
    ["LECTURE_RESOURCE", "LECTURE_RESOURCE", "LECTURE_COMPLETION"],
  );
  assert.ok(STUDY_POINTS_SOURCE_TYPES.includes("LECTURE_RESOURCE"));
  assert.ok(STUDY_POINTS_SOURCE_TYPES.includes("LECTURE_COMPLETION"));
});

test("Phase 2 migration is forward-only and does not backfill historical completions", () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), "prisma/migrations/20261018180000_phase2_lecture_completion_points/migration.sql"),
    "utf8",
  );
  assert.match(migration, /ADD COLUMN "pdfCompletedAt" TIMESTAMP\(3\)/u);
  assert.match(migration, /ADD COLUMN "lectureCompletedAt" TIMESTAMP\(3\)/u);
  assert.match(migration, /'LECTURE_RESOURCE'/u);
  assert.match(migration, /'LECTURE_COMPLETION'/u);
  assert.doesNotMatch(migration, /UPDATE\s+"LectureProgress"/iu);
});

test("normal Lecture UI uses canonical completion endpoints, not synthetic material completion", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/features/lectures/components/LectureDetailView.tsx"),
    "utf8",
  );
  assert.match(source, /\/api\/progress\/lecture\/\$\{encodeURIComponent\(lecture\.id\)\}\/complete/u);
  assert.match(source, /resourceType:\s*"PDF"/u);
  assert.match(source, /resourceType:\s*"NOTES"/u);
  assert.match(source, /resourceType:\s*"LECTURE"/u);
  assert.doesNotMatch(source, /apiClient\("\/api\/progress\/complete"/u);
});

test("server exposes one canonical Lecture completion API for normal view and future Focus Hub", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server.ts"), "utf8");
  assert.match(source, /app\.get\("\/api\/progress\/lecture\/:lectureId"/u);
  assert.match(source, /app\.post\("\/api\/progress\/lecture\/:lectureId\/complete"/u);
  assert.match(source, /LectureProgressCompletionService/u);
});
