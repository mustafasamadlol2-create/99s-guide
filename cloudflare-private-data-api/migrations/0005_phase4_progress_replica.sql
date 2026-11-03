-- Phase 4: complete private progress read replica.
-- Supabase/PostgreSQL remains canonical for writes.

ALTER TABLE "LectureProgress" ADD COLUMN "pdfCompletedAt" TEXT;
ALTER TABLE "LectureProgress" ADD COLUMN "notesCompletedAt" TEXT;
ALTER TABLE "LectureProgress" ADD COLUMN "videoCompletedAt" TEXT;
ALTER TABLE "LectureProgress" ADD COLUMN "flashcardsCompletedAt" TEXT;
ALTER TABLE "LectureProgress" ADD COLUMN "quizCompletedAt" TEXT;
ALTER TABLE "LectureProgress" ADD COLUMN "lectureCompletedAt" TEXT;

CREATE TABLE IF NOT EXISTS "VideoWatchProgress" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "lectureId" TEXT,
  "sessionId" TEXT,
  "durationSeconds" INTEGER NOT NULL DEFAULT 0,
  "verifiedMilliseconds" INTEGER NOT NULL DEFAULT 0,
  "lastPositionSeconds" REAL NOT NULL DEFAULT 0,
  "lastHeartbeatAt" TEXT,
  "lastPlayerState" TEXT,
  "lastPlaybackRate" REAL NOT NULL DEFAULT 1,
  "completedAt" TEXT,
  "createdAt" TEXT,
  "updatedAt" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "VideoWatchProgress_userId_materialId_key"
  ON "VideoWatchProgress" ("userId", "materialId");
CREATE INDEX IF NOT EXISTS "VideoWatchProgress_userId_lectureId_idx"
  ON "VideoWatchProgress" ("userId", "lectureId");
CREATE INDEX IF NOT EXISTS "VideoWatchProgress_materialId_idx"
  ON "VideoWatchProgress" ("materialId");
