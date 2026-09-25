CREATE TABLE "GroupFocusRun" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "summaryId" TEXT NOT NULL,
    "runtimeInstanceId" TEXT NOT NULL,
    "summaryVersion" INTEGER NOT NULL,
    "summaryHash" CHAR(64) NOT NULL,
    "mode" TEXT NOT NULL,
    "focusDurationSeconds" INTEGER NOT NULL,
    "breakDurationSeconds" INTEGER NOT NULL,
    "roundCount" INTEGER NOT NULL,
    "runtimeStartedAt" TIMESTAMP(3) NOT NULL,
    "runtimeEndedAt" TIMESTAMP(3) NOT NULL,
    "terminalReason" TEXT NOT NULL,
    "completedRounds" INTEGER NOT NULL,
    "finalRevision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupFocusRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupFocusParticipantSummary" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "effectiveLectureId" TEXT NOT NULL,
    "firstConnectedAt" TIMESTAMP(3) NOT NULL,
    "lastDisconnectedAt" TIMESTAMP(3),
    "reconnectCount" INTEGER NOT NULL,
    "verifiedFocusSeconds" INTEGER NOT NULL,
    "rounds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupFocusParticipantSummary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GroupFocusRun_roomId_key" ON "GroupFocusRun"("roomId");
CREATE UNIQUE INDEX "GroupFocusRun_summaryId_key" ON "GroupFocusRun"("summaryId");
CREATE UNIQUE INDEX "GroupFocusRun_runtimeInstanceId_key" ON "GroupFocusRun"("runtimeInstanceId");
CREATE INDEX "GroupFocusRun_runtimeEndedAt_idx" ON "GroupFocusRun"("runtimeEndedAt");

CREATE UNIQUE INDEX "GroupFocusParticipantSummary_membershipId_key"
    ON "GroupFocusParticipantSummary"("membershipId");
CREATE UNIQUE INDEX "GroupFocusParticipantSummary_runId_userId_key"
    ON "GroupFocusParticipantSummary"("runId", "userId");
CREATE INDEX "GroupFocusParticipantSummary_userId_createdAt_idx"
    ON "GroupFocusParticipantSummary"("userId", "createdAt");
CREATE INDEX "GroupFocusParticipantSummary_effectiveLectureId_createdAt_idx"
    ON "GroupFocusParticipantSummary"("effectiveLectureId", "createdAt");

ALTER TABLE "GroupFocusRun"
    ADD CONSTRAINT "GroupFocusRun_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "GroupFocusRoom"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GroupFocusParticipantSummary"
    ADD CONSTRAINT "GroupFocusParticipantSummary_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "GroupFocusRun"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupFocusParticipantSummary"
    ADD CONSTRAINT "GroupFocusParticipantSummary_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupFocusParticipantSummary"
    ADD CONSTRAINT "GroupFocusParticipantSummary_membershipId_fkey"
    FOREIGN KEY ("membershipId") REFERENCES "GroupFocusMembership"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupFocusParticipantSummary"
    ADD CONSTRAINT "GroupFocusParticipantSummary_effectiveLectureId_fkey"
    FOREIGN KEY ("effectiveLectureId") REFERENCES "Lecture"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;