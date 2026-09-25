CREATE TABLE "StudyPointsBalanceProjection" (
    "userId" TEXT NOT NULL,
    "focusPoints" BIGINT NOT NULL DEFAULT 0,
    "masteryPoints" BIGINT NOT NULL DEFAULT 0,
    "progressPoints" BIGINT NOT NULL DEFAULT 0,
    "consistencyPoints" BIGINT NOT NULL DEFAULT 0,
    "totalPoints" BIGINT NOT NULL DEFAULT 0,
    "ledgerEntryCount" BIGINT NOT NULL DEFAULT 0,
    "projectionVersion" BIGINT NOT NULL DEFAULT 0,
    "lastReconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyPointsBalanceProjection_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "StudyPointsBalanceProjection_lastReconciledAt_idx"
    ON "StudyPointsBalanceProjection"("lastReconciledAt");

ALTER TABLE "StudyPointsBalanceProjection"
    ADD CONSTRAINT "StudyPointsBalanceProjection_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;