-- CreateTable
CREATE TABLE "FocusPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "timezone" TEXT NOT NULL,
    "planVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "FocusPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FocusPlanItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "lectureId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "sessionCount" INTEGER NOT NULL,
    "focusDurationSeconds" INTEGER NOT NULL,
    "breakDurationSeconds" INTEGER NOT NULL,
    "includeMcq" BOOLEAN NOT NULL,
    "includeFlashcards" BOOLEAN NOT NULL,
    "includeVideo" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FocusPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FocusSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planItemId" TEXT NOT NULL,
    "lectureId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "startedAt" TIMESTAMP(3),
    "plannedEndAt" TIMESTAMP(3),
    "actualEndedAt" TIMESTAMP(3),
    "lastCheckpointAt" TIMESTAMP(3),
    "activeSeconds" INTEGER NOT NULL DEFAULT 0,
    "pauseSeconds" INTEGER NOT NULL DEFAULT 0,
    "completionReason" TEXT,
    "clientInstanceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FocusSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyEvent" (
    "id" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "eventType" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "lectureId" TEXT,
    "materialId" TEXT,
    "mcqId" TEXT,
    "flashcardId" TEXT,
    "focusSessionId" TEXT,
    "groupFocusRoomId" TEXT,
    "evidenceClass" TEXT NOT NULL,
    "privacyClass" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyDailyMetric" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "metricDate" DATE NOT NULL,
    "focusSeconds" INTEGER NOT NULL DEFAULT 0,
    "sessionsCompleted" INTEGER NOT NULL DEFAULT 0,
    "mcqAttempts" INTEGER NOT NULL DEFAULT 0,
    "mcqCorrect" INTEGER NOT NULL DEFAULT 0,
    "flashcardReviews" INTEGER NOT NULL DEFAULT 0,
    "recallAttempts" INTEGER NOT NULL DEFAULT 0,
    "recallCorrect" INTEGER NOT NULL DEFAULT 0,
    "lectureCompletions" INTEGER NOT NULL DEFAULT 0,
    "interruptionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyDailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FocusPlan_userId_status_updatedAt_idx"
  ON "FocusPlan"("userId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FocusPlanItem_planId_sequence_key"
  ON "FocusPlanItem"("planId", "sequence");

-- CreateIndex
CREATE INDEX "FocusSession_userId_status_updatedAt_idx"
  ON "FocusSession"("userId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "FocusSession_userId_startedAt_idx"
  ON "FocusSession"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "FocusSession_planId_planItemId_idx"
  ON "FocusSession"("planId", "planItemId");

-- CreateIndex
CREATE UNIQUE INDEX "FocusSession_userId_idempotencyKey_key"
  ON "FocusSession"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "StudyEvent_userId_occurredAt_idx"
  ON "StudyEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "StudyEvent_eventType_occurredAt_idx"
  ON "StudyEvent"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "StudyEvent_lectureId_occurredAt_idx"
  ON "StudyEvent"("lectureId", "occurredAt");

-- CreateIndex
CREATE INDEX "StudyEvent_focusSessionId_occurredAt_idx"
  ON "StudyEvent"("focusSessionId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "StudyEvent_userId_idempotencyKey_key"
  ON "StudyEvent"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "StudyDailyMetric_userId_metricDate_key"
  ON "StudyDailyMetric"("userId", "metricDate");

-- AddForeignKey
ALTER TABLE "FocusPlan"
  ADD CONSTRAINT "FocusPlan_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusPlanItem"
  ADD CONSTRAINT "FocusPlanItem_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "FocusPlan"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusPlanItem"
  ADD CONSTRAINT "FocusPlanItem_lectureId_fkey"
  FOREIGN KEY ("lectureId") REFERENCES "Lecture"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusSession"
  ADD CONSTRAINT "FocusSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusSession"
  ADD CONSTRAINT "FocusSession_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "FocusPlan"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusSession"
  ADD CONSTRAINT "FocusSession_planItemId_fkey"
  FOREIGN KEY ("planItemId") REFERENCES "FocusPlanItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusSession"
  ADD CONSTRAINT "FocusSession_lectureId_fkey"
  FOREIGN KEY ("lectureId") REFERENCES "Lecture"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyEvent"
  ADD CONSTRAINT "StudyEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyEvent"
  ADD CONSTRAINT "StudyEvent_lectureId_fkey"
  FOREIGN KEY ("lectureId") REFERENCES "Lecture"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyEvent"
  ADD CONSTRAINT "StudyEvent_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyEvent"
  ADD CONSTRAINT "StudyEvent_mcqId_fkey"
  FOREIGN KEY ("mcqId") REFERENCES "Mcq"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyEvent"
  ADD CONSTRAINT "StudyEvent_flashcardId_fkey"
  FOREIGN KEY ("flashcardId") REFERENCES "Flashcard"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyEvent"
  ADD CONSTRAINT "StudyEvent_focusSessionId_fkey"
  FOREIGN KEY ("focusSessionId") REFERENCES "FocusSession"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyDailyMetric"
  ADD CONSTRAINT "StudyDailyMetric_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;