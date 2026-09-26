CREATE TABLE "LeaderboardD1SyncOutbox" (
    "id" BIGSERIAL NOT NULL,
    "workType" VARCHAR(16) NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL DEFAULT -1,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" VARCHAR(500),
    "leaseGeneration" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    CONSTRAINT "LeaderboardD1SyncOutbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LeaderboardD1SyncOutbox_work_type_check" CHECK ("workType" IN ('BEGIN', 'CHUNK', 'COMMIT')),
    CONSTRAINT "LeaderboardD1SyncOutbox_chunk_index_check" CHECK (("workType" = 'CHUNK' AND "chunkIndex" >= 0) OR ("workType" <> 'CHUNK' AND "chunkIndex" = -1))
);
CREATE UNIQUE INDEX "leaderboard_d1_outbox_snapshot_work_key"
  ON "LeaderboardD1SyncOutbox" ("snapshotId", "workType", "chunkIndex");
CREATE INDEX "leaderboard_d1_outbox_next_attempt_idx"
  ON "LeaderboardD1SyncOutbox" ("nextAttemptAt", "id");