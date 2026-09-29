-- Persist delivery lifecycle and terminal retention without deleting or
-- rewriting existing outbox payloads. Existing rows remain actionable PENDING.
ALTER TABLE "PrivateD1SyncOutbox"
  ADD COLUMN "state" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "failureClass" VARCHAR(32),
  ADD COLUMN "failureCode" VARCHAR(64),
  ADD COLUMN "firstAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "leaseUntil" TIMESTAMP(3),
  ADD COLUMN "terminalAt" TIMESTAMP(3);

ALTER TABLE "PrivateD1SyncOutbox"
  ADD CONSTRAINT "PrivateD1SyncOutbox_state_check"
    CHECK ("state" IN ('PENDING', 'RETRY', 'BLOCKED', 'POISON', 'SUCCEEDED')),
  ADD CONSTRAINT "PrivateD1SyncOutbox_failure_class_check"
    CHECK ("failureClass" IS NULL OR "failureClass" IN ('TRANSIENT', 'AUTH_CONFIGURATION', 'PERMANENT', 'OPERATIONAL')),
  ADD CONSTRAINT "PrivateD1SyncOutbox_terminal_state_check"
    CHECK (("state" IN ('POISON', 'SUCCEEDED')) = ("terminalAt" IS NOT NULL)),
  ADD CONSTRAINT "PrivateD1SyncOutbox_terminal_lease_check"
    CHECK ("state" NOT IN ('POISON', 'SUCCEEDED') OR "leaseUntil" IS NULL);

CREATE INDEX "private_d1_outbox_state_due_idx"
  ON "PrivateD1SyncOutbox" ("state", "nextAttemptAt", "id");
CREATE INDEX "private_d1_outbox_state_terminal_idx"
  ON "PrivateD1SyncOutbox" ("state", "terminalAt", "id");

ALTER TABLE "LeaderboardD1SyncOutbox"
  ADD COLUMN "projectionGeneration" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "state" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "failureClass" VARCHAR(32),
  ADD COLUMN "failureCode" VARCHAR(64),
  ADD COLUMN "firstAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "terminalAt" TIMESTAMP(3);

ALTER TABLE "LeaderboardD1SyncOutbox"
  ADD CONSTRAINT "LeaderboardD1SyncOutbox_state_check"
    CHECK ("state" IN ('PENDING', 'RETRY', 'BLOCKED', 'POISON', 'SUCCEEDED')),
  ADD CONSTRAINT "LeaderboardD1SyncOutbox_failure_class_check"
    CHECK ("failureClass" IS NULL OR "failureClass" IN ('TRANSIENT', 'AUTH_CONFIGURATION', 'PERMANENT', 'OPERATIONAL')),
  ADD CONSTRAINT "LeaderboardD1SyncOutbox_terminal_state_check"
    CHECK (("state" IN ('POISON', 'SUCCEEDED')) = ("terminalAt" IS NOT NULL)),
  ADD CONSTRAINT "LeaderboardD1SyncOutbox_terminal_lease_check"
    CHECK ("state" NOT IN ('POISON', 'SUCCEEDED') OR "leaseUntil" IS NULL);

DROP INDEX "leaderboard_d1_outbox_snapshot_work_key";
CREATE UNIQUE INDEX "leaderboard_d1_outbox_snapshot_work_generation_key"
  ON "LeaderboardD1SyncOutbox" ("snapshotId", "workType", "chunkIndex", "projectionGeneration");
CREATE INDEX "leaderboard_d1_outbox_state_due_idx"
  ON "LeaderboardD1SyncOutbox" ("state", "nextAttemptAt", "id");
CREATE INDEX "leaderboard_d1_outbox_state_terminal_idx"
  ON "LeaderboardD1SyncOutbox" ("state", "terminalAt", "id");