-- Add private, PostgreSQL-only Focus Quick Notes. Existing data is untouched.
CREATE TABLE "FocusQuickNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "focusSessionId" TEXT NOT NULL,
    "lectureId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT NOT NULL,
    "convertedToPlanItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),

    CONSTRAINT "FocusQuickNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FocusQuickNote_convertedToPlanItemId_key"
    ON "FocusQuickNote"("convertedToPlanItemId");
CREATE UNIQUE INDEX "FocusQuickNote_userId_idempotencyKey_key"
    ON "FocusQuickNote"("userId", "idempotencyKey");
CREATE INDEX "FocusQuickNote_userId_createdAt_idx"
    ON "FocusQuickNote"("userId", "createdAt");
CREATE INDEX "FocusQuickNote_focusSessionId_createdAt_idx"
    ON "FocusQuickNote"("focusSessionId", "createdAt");
CREATE INDEX "FocusQuickNote_lectureId_createdAt_idx"
    ON "FocusQuickNote"("lectureId", "createdAt");

ALTER TABLE "FocusQuickNote"
    ADD CONSTRAINT "FocusQuickNote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FocusQuickNote"
    ADD CONSTRAINT "FocusQuickNote_focusSessionId_fkey"
    FOREIGN KEY ("focusSessionId") REFERENCES "FocusSession"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FocusQuickNote"
    ADD CONSTRAINT "FocusQuickNote_lectureId_fkey"
    FOREIGN KEY ("lectureId") REFERENCES "Lecture"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FocusQuickNote"
    ADD CONSTRAINT "FocusQuickNote_convertedToPlanItemId_fkey"
    FOREIGN KEY ("convertedToPlanItemId") REFERENCES "FocusPlanItem"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;