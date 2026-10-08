ALTER TABLE "StudyPointsLedgerEntry"
    DROP CONSTRAINT "StudyPointsLedgerEntry_category_check";

ALTER TABLE "StudyPointsLedgerEntry"
    ADD CONSTRAINT "StudyPointsLedgerEntry_category_check"
    CHECK ("category" IN ('FOCUS', 'MASTERY', 'PROGRESS', 'CONSISTENCY', 'LEGACY'));

ALTER TABLE "StudyPointsBalanceProjection"
    ADD COLUMN "legacyPoints" BIGINT NOT NULL DEFAULT 0;

CREATE TABLE "StudyPointsLegacyCutover" (
    "userId" TEXT NOT NULL,
    "legacyUserPoints" INTEGER NOT NULL,
    "legacyPointsLogTotal" BIGINT NOT NULL,
    "legacyPointsLogRowCount" BIGINT NOT NULL,
    "legacyAdjustment" BIGINT NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "StudyPointsLegacyCutover_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "StudyPointsLegacyCutover_status_check"
        CHECK ("status" IN ('PENDING', 'COMPLETED')),
    CONSTRAINT "StudyPointsLegacyCutover_row_count_check"
        CHECK ("legacyPointsLogRowCount" >= 0)
);

CREATE INDEX "StudyPointsLegacyCutover_status_userId_idx"
    ON "StudyPointsLegacyCutover"("status", "userId");

ALTER TABLE "StudyPointsLegacyCutover"
    ADD CONSTRAINT "StudyPointsLegacyCutover_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
