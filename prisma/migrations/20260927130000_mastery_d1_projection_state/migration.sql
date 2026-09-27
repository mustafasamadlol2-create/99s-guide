-- Prompt 33: PostgreSQL-side expected D1 projection watermarks.
-- D1 remains derived; this row only lets the backend fail closed on incomplete cache.
CREATE TABLE "MasteryD1ProjectionState" (
  "userId" TEXT NOT NULL,
  "masteryWatermark" BIGINT,
  "retentionWatermark" BIGINT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MasteryD1ProjectionState_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "MasteryD1ProjectionState_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);