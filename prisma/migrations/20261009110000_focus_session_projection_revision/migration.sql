ALTER TABLE "FocusSession"
    ADD COLUMN "projectionRevision" BIGINT NOT NULL DEFAULT 0;

-- Preserve the latest retained outbox fence; compacted entries were already delivered.
UPDATE "FocusSession" AS session
SET "projectionRevision" = COALESCE((
    SELECT MAX(outbox."revision")
    FROM "PrivateD1SyncOutbox" AS outbox
    WHERE outbox."entity" = 'FocusSession'
      AND outbox."operation" = 'upsert'
      AND outbox."data"->>'id' = session."id"
), 0);
