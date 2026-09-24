-- Infrastructure-only outbox. BIGSERIAL provides the one monotonic identity
-- sequence used by both id and revision; enqueue explicitly inserts that one
-- allocated value into both fields so the default is not consumed twice.
CREATE TABLE "PrivateD1SyncOutbox" (
    "id" BIGSERIAL NOT NULL,
    "entity" VARCHAR(100) NOT NULL,
    "operation" VARCHAR(16) NOT NULL,
    "key" JSONB NOT NULL,
    "revision" BIGINT NOT NULL,
    "data" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" VARCHAR(500),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrivateD1SyncOutbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrivateD1SyncOutbox_nextAttemptAt_id_idx"
ON "PrivateD1SyncOutbox"("nextAttemptAt", "id");