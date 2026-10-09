ALTER TABLE "StudyDailyMetric"
    ADD COLUMN "projectionRevision" BIGINT NOT NULL DEFAULT 0;

-- Preserve the current projection fence for rows whose latest outbox entry is
-- still retained. Compacted entries were already delivered before removal.
UPDATE "StudyDailyMetric" AS metric
SET "projectionRevision" = COALESCE((
    SELECT MAX(outbox."revision")
    FROM "PrivateD1SyncOutbox" AS outbox
    WHERE outbox."entity" = 'StudyDailyMetric'
      AND outbox."operation" = 'upsert'
      AND outbox."data"->>'id' = metric."id"
), 0);
