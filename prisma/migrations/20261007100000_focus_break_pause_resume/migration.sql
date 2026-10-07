ALTER TABLE "FocusBreak"
    ADD COLUMN "pausedAt" TIMESTAMP(3),
    ADD COLUMN "pausedRemainingSeconds" INTEGER,
    ADD CONSTRAINT "FocusBreak_pause_state_check"
        CHECK (
            ("pausedAt" IS NULL) = ("pausedRemainingSeconds" IS NULL)
            AND (
                "pausedRemainingSeconds" IS NULL
                OR "pausedRemainingSeconds" BETWEEN 0 AND "durationSeconds"
            )
        );

CREATE TABLE "FocusBreakCommand" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "focusBreakId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FocusBreakCommand_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FocusBreakCommand_action_check" CHECK ("action" IN ('PAUSE', 'RESUME'))
);

CREATE UNIQUE INDEX "FocusBreakCommand_userId_idempotencyKey_key"
    ON "FocusBreakCommand"("userId", "idempotencyKey");
CREATE INDEX "FocusBreakCommand_focusBreakId_createdAt_idx"
    ON "FocusBreakCommand"("focusBreakId", "createdAt");

ALTER TABLE "FocusBreakCommand"
    ADD CONSTRAINT "FocusBreakCommand_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FocusBreakCommand"
    ADD CONSTRAINT "FocusBreakCommand_focusBreakId_fkey"
    FOREIGN KEY ("focusBreakId") REFERENCES "FocusBreak"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
