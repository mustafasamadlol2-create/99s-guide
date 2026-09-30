-- Restore compatibility between the pre-Study-Engine private-D1 mirror trigger
-- and the new Study Engine outbox schema.
--
-- Production had an existing private_d1_enqueue_mirror() trigger function and
-- PrivateD1SyncOutbox shape before the Study Engine formalized the outbox in
-- Prisma. The new table intentionally uses the same canonical queue, but the
-- legacy trigger must never be allowed to make a PostgreSQL write fail. This
-- migration keeps the newer lifecycle columns while restoring legacy fields
-- and replacing the trigger body with a fail-open enqueue compatible with the
-- current outbox contract.

ALTER TABLE "PrivateD1SyncOutbox"
  ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "PrivateD1SyncOutbox"
  ALTER COLUMN "revision" SET DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PrivateD1SyncOutbox_dedupeKey_key'
      AND conrelid = '"PrivateD1SyncOutbox"'::regclass
  ) THEN
    ALTER TABLE "PrivateD1SyncOutbox"
      ADD CONSTRAINT "PrivateD1SyncOutbox_dedupeKey_key" UNIQUE ("dedupeKey");
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PrivateD1SyncOutbox_operation_check'
      AND conrelid = '"PrivateD1SyncOutbox"'::regclass
  ) THEN
    ALTER TABLE "PrivateD1SyncOutbox"
      ADD CONSTRAINT "PrivateD1SyncOutbox_operation_check"
      CHECK ("operation" IN ('upsert', 'delete'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "PrivateD1SyncOutbox_entity_idx"
  ON "PrivateD1SyncOutbox" ("entity");

CREATE INDEX IF NOT EXISTS "PrivateD1SyncOutbox_nextAttemptAt_idx"
  ON "PrivateD1SyncOutbox" ("nextAttemptAt");

-- Existing triggers in Supabase already reference this function by OID/name.
-- CREATE OR REPLACE preserves those trigger attachments while updating only the
-- enqueue implementation. The function is deliberately fail-open: a cache/
-- projection queue failure must never roll back canonical PostgreSQL writes
-- such as OAuth user/session updates.
CREATE OR REPLACE FUNCTION public.private_d1_enqueue_mirror()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  row_data jsonb;
  mirror_entity text;
  mirror_operation text;
  mirror_key jsonb;
  allocated_revision bigint;
  legacy_dedupe_key text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_data := to_jsonb(OLD);
    mirror_operation := 'delete';
  ELSE
    row_data := to_jsonb(NEW);
    mirror_operation := 'upsert';
  END IF;

  mirror_entity := CASE TG_TABLE_NAME
    WHEN 'User' THEN 'User'
    WHEN 'FlashcardProgress' THEN 'FlashcardProgress'
    WHEN 'LectureProgress' THEN 'LectureProgress'
    WHEN 'ModerationHistory' THEN 'ModerationHistory'
    WHEN 'Notification' THEN 'Notification'
    WHEN 'PointsLog' THEN 'PointsLog'
    WHEN 'QaAnswer' THEN 'QaAnswer'
    WHEN 'QaQuestion' THEN 'QaQuestion'
    WHEN 'QaVote' THEN 'QaVote'
    WHEN 'Report' THEN 'Report'
    WHEN 'SmartNotification' THEN 'SmartNotification'
    WHEN 'UserBan' THEN 'UserBan'
    WHEN 'UserBlock' THEN 'UserBlock'
    WHEN 'UserMute' THEN 'UserMute'
    WHEN 'UserProgress' THEN 'UserProgress'
    WHEN 'CalendarEvent' THEN 'UserCalendarEvent'
    ELSE NULL
  END;

  -- Unknown/non-private tables are intentionally ignored rather than allowed
  -- to interfere with their canonical write.
  IF mirror_entity IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Academic/global calendar rows are not private student planner projections.
  IF mirror_entity = 'UserCalendarEvent'
     AND COALESCE(row_data ->> 'userId', '') = '' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF mirror_entity = 'LectureProgress' THEN
    mirror_key := jsonb_build_object(
      'userId', row_data ->> 'userId',
      'lectureId', row_data ->> 'lectureId'
    );
    IF COALESCE(mirror_key ->> 'userId', '') = ''
       OR COALESCE(mirror_key ->> 'lectureId', '') = '' THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;
  ELSE
    mirror_key := jsonb_build_object('id', row_data ->> 'id');
    IF COALESCE(mirror_key ->> 'id', '') = '' THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;
  END IF;

  BEGIN
    SELECT nextval(
      pg_get_serial_sequence('public."PrivateD1SyncOutbox"', 'id')
    )::bigint
    INTO allocated_revision;

    -- dedupeKey remains only for backwards schema compatibility. New queue
    -- semantics use immutable monotonic id/revision rows, so each mutation gets
    -- its own compatibility key instead of coalescing/rewriting a terminal row.
    legacy_dedupe_key := mirror_entity || ':' || mirror_operation || ':' || allocated_revision::text;

    INSERT INTO public."PrivateD1SyncOutbox" (
      "id",
      "dedupeKey",
      "entity",
      "operation",
      "key",
      "revision",
      "data",
      "attempts",
      "lastError",
      "nextAttemptAt",
      "createdAt",
      "updatedAt"
    ) VALUES (
      allocated_revision,
      legacy_dedupe_key,
      mirror_entity,
      mirror_operation,
      mirror_key,
      allocated_revision,
      CASE WHEN mirror_operation = 'upsert' THEN row_data ELSE NULL END,
      0,
      NULL,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    );
  EXCEPTION WHEN OTHERS THEN
    -- Canonical PostgreSQL is authoritative. A non-critical D1 projection
    -- enqueue failure must never make login/profile/content writes fail.
    RAISE WARNING 'private_d1_enqueue_mirror enqueue failed for %.%: %',
      TG_TABLE_NAME, TG_OP, SQLERRM;
  END;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
