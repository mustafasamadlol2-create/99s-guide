-- Phase 1 — complete CalendarEvent read-replica fields.
-- Supabase remains canonical; D1 mirrors the fields required by student reads.

ALTER TABLE "CalendarEvent" ADD COLUMN "allDay" INTEGER NOT NULL DEFAULT 0 CHECK ("allDay" IN (0, 1));
ALTER TABLE "CalendarEvent" ADD COLUMN "importSource" TEXT;
ALTER TABLE "CalendarEvent" ADD COLUMN "sourceDocumentName" TEXT;
ALTER TABLE "CalendarEvent" ADD COLUMN "sourceDocumentSha256" TEXT;
ALTER TABLE "CalendarEvent" ADD COLUMN "sourcePage" INTEGER;
ALTER TABLE "CalendarEvent" ADD COLUMN "importFingerprint" TEXT;

CREATE INDEX IF NOT EXISTS "CalendarEvent_sourceDocumentSha256_idx"
  ON "CalendarEvent" ("sourceDocumentSha256");

CREATE UNIQUE INDEX IF NOT EXISTS "CalendarEvent_importFingerprint_key"
  ON "CalendarEvent" ("importFingerprint")
  WHERE "importFingerprint" IS NOT NULL;
