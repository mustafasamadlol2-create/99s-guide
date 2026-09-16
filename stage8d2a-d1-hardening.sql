-- 99's Guide — Stage 8D-2A D1 private mirror hardening
-- Keeps the schema, removes credential/token material from D1, and adds a
-- dedicated table for PERSONAL calendar rows. Global CalendarEvent remains
-- untouched and continues to be managed by the existing content Worker.

PRAGMA foreign_keys = ON;

DELETE FROM "PasswordResetToken";
DELETE FROM "EmailVerificationToken";
DELETE FROM "OAuthIdentity";

UPDATE "User"
SET
  "passwordHash" = NULL,
  "socketId" = NULL,
  "deviceToken" = NULL,
  "signature" = NULL
WHERE
  "passwordHash" IS NOT NULL OR
  "socketId" IS NOT NULL OR
  "deviceToken" IS NOT NULL OR
  "signature" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "UserCalendarEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "startDateTime" TEXT NOT NULL,
  "endDateTime" TEXT NOT NULL,
  "targetGroups" TEXT NOT NULL,
  "description" TEXT,
  "subjectId" TEXT,
  "lectureId" TEXT,
  "room" TEXT,
  "doctor" TEXT,
  "notes" TEXT,
  "isPinned" INTEGER NOT NULL CHECK ("isPinned" IN (0, 1)),
  "isCompleted" INTEGER NOT NULL CHECK ("isCompleted" IN (0, 1)),
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "UserCalendarEvent_userId_idx"
  ON "UserCalendarEvent"("userId");

CREATE INDEX IF NOT EXISTS "UserCalendarEvent_startDateTime_idx"
  ON "UserCalendarEvent"("startDateTime");

CREATE INDEX IF NOT EXISTS "UserCalendarEvent_eventType_idx"
  ON "UserCalendarEvent"("eventType");

CREATE INDEX IF NOT EXISTS "UserCalendarEvent_targetGroups_idx"
  ON "UserCalendarEvent"("targetGroups");
