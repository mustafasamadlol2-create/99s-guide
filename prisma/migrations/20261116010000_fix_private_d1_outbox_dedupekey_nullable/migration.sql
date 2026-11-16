-- 99's Guide: MCQ P2011, PrivateD1SyncOutbox schema drift hotfix
-- Non-destructive: keeps the extra dedupeKey column and all existing rows.
-- Canonical outbox writers / phase3_enqueue_outbox do not provide dedupeKey.
-- Run in Supabase SQL Editor, on the SAME database used by Render.
-- This SQL is idempotent and intentionally does not change any other column.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $repair$
DECLARE
  v_nullable TEXT;
BEGIN
  SELECT is_nullable INTO v_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'PrivateD1SyncOutbox'
    AND column_name = 'dedupeKey';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expected public.PrivateD1SyncOutbox.dedupeKey not found; no changes made';
  END IF;

  IF v_nullable = 'NO' THEN
    ALTER TABLE public."PrivateD1SyncOutbox"
      ALTER COLUMN "dedupeKey" DROP NOT NULL;
    RAISE NOTICE 'Fixed: dedupeKey is now nullable; existing values preserved';
  ELSIF v_nullable = 'YES' THEN
    RAISE NOTICE 'Already fixed: dedupeKey is nullable';
  ELSE
    RAISE EXCEPTION 'Unexpected is_nullable value: %', v_nullable;
  END IF;
END;
$repair$;
COMMIT;
