-- 99's Guide — Cloudflare D1 shared-content schema
-- Stage 4B
-- Source: current Supabase schema audit (2026-09-01)
-- IMPORTANT:
--   * This creates COPY targets only.
--   * It does not delete or modify Supabase.
--   * Material.fileData is intentionally omitted because binary PDFs/notes live in R2.
--   * Mcq.correctAnswer is stored server-side in D1 but must never be returned in public/client payloads.
--   * CalendarEvent is intended only for global/shared rows (userId IS NULL).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "Lecture" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "mainSubject" TEXT NOT NULL,
  "subSubject" TEXT,
  "trackMode" TEXT NOT NULL,
  "department" TEXT,
  "createdAt" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "Lecture_mainSubject_idx"
  ON "Lecture" ("mainSubject");

CREATE INDEX IF NOT EXISTS "Lecture_subject_path_idx"
  ON "Lecture" ("mainSubject", "subSubject", "trackMode", "department");


CREATE TABLE IF NOT EXISTS "Material" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "title" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "fileUrlOrLink" TEXT NOT NULL,
  "lectureId" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "storagePath" TEXT,
  FOREIGN KEY ("lectureId")
    REFERENCES "Lecture" ("id")
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "Material_lectureId_idx"
  ON "Material" ("lectureId");

CREATE INDEX IF NOT EXISTS "Material_lecture_type_idx"
  ON "Material" ("lectureId", "type");


CREATE TABLE IF NOT EXISTS "Mcq" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "question" TEXT NOT NULL,
  "optionA" TEXT NOT NULL,
  "optionB" TEXT NOT NULL,
  "optionC" TEXT NOT NULL,
  "optionD" TEXT NOT NULL,
  "correctAnswer" TEXT NOT NULL,
  "hint" TEXT,
  "explanation" TEXT,
  "sourceType" TEXT NOT NULL DEFAULT 'ai',
  "sourceRef" TEXT NOT NULL DEFAULT '',
  "difficulty" TEXT NOT NULL DEFAULT 'Medium',
  "lectureId" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  FOREIGN KEY ("lectureId")
    REFERENCES "Lecture" ("id")
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "Mcq_lectureId_idx"
  ON "Mcq" ("lectureId");

CREATE INDEX IF NOT EXISTS "Mcq_lecture_difficulty_idx"
  ON "Mcq" ("lectureId", "difficulty");


CREATE TABLE IF NOT EXISTS "Flashcard" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clinicalConcept" TEXT NOT NULL,
  "explanation" TEXT NOT NULL,
  "lectureId" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  FOREIGN KEY ("lectureId")
    REFERENCES "Lecture" ("id")
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "Flashcard_lectureId_idx"
  ON "Flashcard" ("lectureId");


CREATE TABLE IF NOT EXISTS "DailyMotto" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "message" TEXT NOT NULL,
  "isActive" INTEGER NOT NULL DEFAULT 1 CHECK ("isActive" IN (0, 1)),
  "isFeatured" INTEGER NOT NULL DEFAULT 0 CHECK ("isFeatured" IN (0, 1)),
  "createdBy" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "DailyMotto_active_idx"
  ON "DailyMotto" ("isActive", "createdAt");


CREATE TABLE IF NOT EXISTS "CalendarEvent" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT,
  "title" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "startDateTime" TEXT NOT NULL,
  "endDateTime" TEXT NOT NULL,
  "targetGroups" TEXT NOT NULL DEFAULT 'ALL',
  "description" TEXT,
  "subjectId" TEXT,
  "lectureId" TEXT,
  "room" TEXT,
  "doctor" TEXT,
  "notes" TEXT,
  "isPinned" INTEGER NOT NULL DEFAULT 0 CHECK ("isPinned" IN (0, 1)),
  "isCompleted" INTEGER NOT NULL DEFAULT 0 CHECK ("isCompleted" IN (0, 1)),
  FOREIGN KEY ("lectureId")
    REFERENCES "Lecture" ("id")
    ON UPDATE CASCADE
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "CalendarEvent_start_idx"
  ON "CalendarEvent" ("startDateTime");

CREATE INDEX IF NOT EXISTS "CalendarEvent_group_start_idx"
  ON "CalendarEvent" ("targetGroups", "startDateTime");

-- Guardrail: D1 is only for shared/global calendar events.
CREATE TRIGGER IF NOT EXISTS "CalendarEvent_global_only_insert"
BEFORE INSERT ON "CalendarEvent"
WHEN NEW."userId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'D1 CalendarEvent accepts global rows only');
END;

CREATE TRIGGER IF NOT EXISTS "CalendarEvent_global_only_update"
BEFORE UPDATE OF "userId" ON "CalendarEvent"
WHEN NEW."userId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'D1 CalendarEvent accepts global rows only');
END;
