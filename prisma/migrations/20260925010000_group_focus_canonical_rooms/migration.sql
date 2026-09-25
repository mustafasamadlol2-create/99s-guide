-- Add canonical Group Focus Room and membership control-plane storage only.
CREATE TABLE "GroupFocusRoom" (
    "id" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "sharedLectureId" TEXT,
    "focusDurationSeconds" INTEGER NOT NULL,
    "breakDurationSeconds" INTEGER NOT NULL,
    "roundCount" INTEGER NOT NULL,
    "maxParticipants" INTEGER NOT NULL DEFAULT 12,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createIdempotencyKey" TEXT NOT NULL,
    "inviteTokenHash" TEXT,
    "inviteVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "GroupFocusRoom_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupFocusMembership" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "selectedLectureId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupFocusMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GroupFocusRoom_hostUserId_createIdempotencyKey_key"
    ON "GroupFocusRoom"("hostUserId", "createIdempotencyKey");
CREATE INDEX "GroupFocusRoom_visibility_status_createdAt_idx"
    ON "GroupFocusRoom"("visibility", "status", "createdAt");
CREATE INDEX "GroupFocusRoom_hostUserId_status_idx"
    ON "GroupFocusRoom"("hostUserId", "status");
CREATE INDEX "GroupFocusRoom_sharedLectureId_idx"
    ON "GroupFocusRoom"("sharedLectureId");

CREATE UNIQUE INDEX "GroupFocusMembership_roomId_userId_key"
    ON "GroupFocusMembership"("roomId", "userId");
CREATE INDEX "GroupFocusMembership_roomId_status_idx"
    ON "GroupFocusMembership"("roomId", "status");
CREATE INDEX "GroupFocusMembership_userId_status_idx"
    ON "GroupFocusMembership"("userId", "status");
CREATE INDEX "GroupFocusMembership_selectedLectureId_idx"
    ON "GroupFocusMembership"("selectedLectureId");

ALTER TABLE "GroupFocusRoom"
    ADD CONSTRAINT "GroupFocusRoom_hostUserId_fkey"
    FOREIGN KEY ("hostUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupFocusRoom"
    ADD CONSTRAINT "GroupFocusRoom_sharedLectureId_fkey"
    FOREIGN KEY ("sharedLectureId") REFERENCES "Lecture"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GroupFocusMembership"
    ADD CONSTRAINT "GroupFocusMembership_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "GroupFocusRoom"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupFocusMembership"
    ADD CONSTRAINT "GroupFocusMembership_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupFocusMembership"
    ADD CONSTRAINT "GroupFocusMembership_selectedLectureId_fkey"
    FOREIGN KEY ("selectedLectureId") REFERENCES "Lecture"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;