-- Prompt 6: private D1 read projections for Study Engine Batch A.
-- PostgreSQL remains canonical. This migration is local-only until reviewed.

CREATE TABLE IF NOT EXISTS "FocusPlan" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "canonicalId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "userScope" TEXT NOT NULL,
  "title" TEXT,
  "status" TEXT,
  "timezone" TEXT,
  "planVersion" INTEGER,
  "createdAt" TEXT,
  "updatedAt" TEXT NOT NULL,
  "archivedAt" TEXT,
  "itemsJson" TEXT,
  "projectionVersion" INTEGER NOT NULL,
  "revision" TEXT NOT NULL,
  "deletedAt" TEXT
);

CREATE TABLE IF NOT EXISTS "FocusSession" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "canonicalId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "userScope" TEXT NOT NULL,
  "planId" TEXT,
  "planItemId" TEXT,
  "lectureId" TEXT,
  "status" TEXT,
  "startedAt" TEXT,
  "plannedEndAt" TEXT,
  "actualEndedAt" TEXT,
  "lastCheckpointAt" TEXT,
  "activeSeconds" INTEGER,
  "pauseSeconds" INTEGER,
  "completionReason" TEXT,
  "updatedAt" TEXT NOT NULL,
  "projectionVersion" INTEGER NOT NULL,
  "revision" TEXT NOT NULL,
  "deletedAt" TEXT
);

CREATE TABLE IF NOT EXISTS "StudyDailyMetric" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "canonicalId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "userScope" TEXT NOT NULL,
  "metricDate" TEXT,
  "focusSeconds" INTEGER,
  "sessionsCompleted" INTEGER,
  "mcqAttempts" INTEGER,
  "mcqCorrect" INTEGER,
  "flashcardReviews" INTEGER,
  "recallAttempts" INTEGER,
  "recallCorrect" INTEGER,
  "lectureCompletions" INTEGER,
  "interruptionCount" INTEGER,
  "updatedAt" TEXT NOT NULL,
  "projectionVersion" INTEGER NOT NULL,
  "revision" TEXT NOT NULL,
  "deletedAt" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "FocusPlan_canonicalId_key"
  ON "FocusPlan" ("canonicalId");

CREATE INDEX IF NOT EXISTS "FocusPlan_userScope_status_updatedAt_idx"
  ON "FocusPlan" ("userScope", "status", "updatedAt");

CREATE INDEX IF NOT EXISTS "FocusPlan_userScope_canonicalId_idx"
  ON "FocusPlan" ("userScope", "canonicalId");

CREATE UNIQUE INDEX IF NOT EXISTS "FocusSession_canonicalId_key"
  ON "FocusSession" ("canonicalId");

CREATE INDEX IF NOT EXISTS "FocusSession_userScope_status_updatedAt_idx"
  ON "FocusSession" ("userScope", "status", "updatedAt");

CREATE INDEX IF NOT EXISTS "FocusSession_userScope_startedAt_idx"
  ON "FocusSession" ("userScope", "startedAt");

CREATE INDEX IF NOT EXISTS "FocusSession_userScope_canonicalId_idx"
  ON "FocusSession" ("userScope", "canonicalId");

CREATE UNIQUE INDEX IF NOT EXISTS "StudyDailyMetric_canonicalId_key"
  ON "StudyDailyMetric" ("canonicalId");

CREATE UNIQUE INDEX IF NOT EXISTS "StudyDailyMetric_userScope_metricDate_key"
  ON "StudyDailyMetric" ("userScope", "metricDate");

CREATE INDEX IF NOT EXISTS "StudyDailyMetric_userScope_canonicalId_idx"
  ON "StudyDailyMetric" ("userScope", "canonicalId");