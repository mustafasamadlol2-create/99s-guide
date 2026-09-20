ALTER TABLE "CalendarEvent"
  ADD COLUMN "allDay" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "importSource" TEXT,
  ADD COLUMN "sourceDocumentName" TEXT,
  ADD COLUMN "sourceDocumentSha256" TEXT,
  ADD COLUMN "sourcePage" INTEGER,
  ADD COLUMN "importFingerprint" TEXT;

CREATE UNIQUE INDEX "CalendarEvent_importFingerprint_key"
  ON "CalendarEvent"("importFingerprint");

CREATE INDEX "CalendarEvent_sourceDocumentSha256_idx"
  ON "CalendarEvent"("sourceDocumentSha256");

CREATE TABLE "CalendarImportJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'UPLOADED',
  "stage" TEXT NOT NULL DEFAULT 'Uploading',
  "sourceFileName" TEXT NOT NULL,
  "sourceMime" TEXT NOT NULL,
  "sourceSha256" TEXT NOT NULL,
  "sourcePageCount" INTEGER,
  "sourcePath" TEXT,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Baghdad',
  "defaultTargetGroups" TEXT NOT NULL DEFAULT 'ALL',
  "progressCurrent" INTEGER NOT NULL DEFAULT 0,
  "progressTotal" INTEGER NOT NULL DEFAULT 0,
  "previewData" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "CalendarImportJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CalendarImportJob_userId_status_createdAt_idx"
  ON "CalendarImportJob"("userId", "status", "createdAt");

CREATE INDEX "CalendarImportJob_status_updatedAt_idx"
  ON "CalendarImportJob"("status", "updatedAt");

CREATE INDEX "CalendarImportJob_sourceSha256_idx"
  ON "CalendarImportJob"("sourceSha256");

ALTER TABLE "CalendarImportJob"
  ADD CONSTRAINT "CalendarImportJob_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;