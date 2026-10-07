CREATE TABLE "FocusBreak" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "focusSessionId" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "resumeStudyOnReturn" BOOLEAN NOT NULL DEFAULT false,
    "startIdempotencyKey" TEXT NOT NULL,
    "endIdempotencyKey" TEXT,

    CONSTRAINT "FocusBreak_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FocusBreak_durationSeconds_check" CHECK ("durationSeconds" >= 0),
    CONSTRAINT "FocusBreak_endsAt_check" CHECK ("endsAt" >= "startedAt")
);

CREATE UNIQUE INDEX "FocusBreak_userId_startIdempotencyKey_key"
    ON "FocusBreak"("userId", "startIdempotencyKey");
CREATE UNIQUE INDEX "FocusBreak_userId_endIdempotencyKey_key"
    ON "FocusBreak"("userId", "endIdempotencyKey");
CREATE INDEX "FocusBreak_userId_endedAt_startedAt_idx"
    ON "FocusBreak"("userId", "endedAt", "startedAt");
CREATE INDEX "FocusBreak_focusSessionId_endedAt_startedAt_idx"
    ON "FocusBreak"("focusSessionId", "endedAt", "startedAt");

ALTER TABLE "FocusBreak"
    ADD CONSTRAINT "FocusBreak_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FocusBreak"
    ADD CONSTRAINT "FocusBreak_focusSessionId_fkey"
    FOREIGN KEY ("focusSessionId") REFERENCES "FocusSession"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
