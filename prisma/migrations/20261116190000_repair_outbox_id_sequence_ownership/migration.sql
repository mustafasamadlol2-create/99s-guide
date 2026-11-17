-- 99's Guide: repair detached PrivateD1SyncOutbox BIGINT id sequence.
-- Intended for Supabase SQL Editor against the same database used by Render.
-- Creates a *new* public sequence owned by public."PrivateD1SyncOutbox"."id".
-- Preserves all records, existing id/revision values, and original recovery sequence.
-- Safe to rerun. Acquires a brief exclusive table lock; execute off-peak.
BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';

DO $repair$
DECLARE
  v_table oid := 'public."PrivateD1SyncOutbox"'::regclass;
  v_attnum smallint;
  v_default text;
  v_old_name text;
  v_old_oid oid;
  v_attached_name text;
  v_new_oid oid;
  v_old_last bigint := 0;
  v_new_last bigint := 0;
  v_max_id bigint := 0;
  v_max_revision bigint := 0;
  v_safe_start bigint;
BEGIN
  -- Block writers while capturing the existing high-water mark and switching default.
  LOCK TABLE public."PrivateD1SyncOutbox" IN ACCESS EXCLUSIVE MODE;

  SELECT a.attnum INTO v_attnum
  FROM pg_attribute a
  WHERE a.attrelid = v_table AND a.attname = 'id' AND NOT a.attisdropped;
  IF v_attnum IS NULL THEN
    RAISE EXCEPTION 'Outbox id column missing; no changes made';
  END IF;

  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_default
  FROM pg_attrdef d WHERE d.adrelid = v_table AND d.adnum = v_attnum;
  IF v_default IS NULL THEN
    RAISE EXCEPTION 'Outbox id has no default; manual review required';
  END IF;

  -- Example existing default: nextval('guide_prisma_recovery."PrivateD1SyncOutbox_id_seq"'::regclass)
  v_old_name := substring(v_default FROM 'nextval\(''([^'']+)''::regclass\)');
  IF v_old_name IS NULL THEN
    RAISE EXCEPTION 'Unexpected outbox id default (%); manual review required', v_default;
  END IF;
  v_old_oid := to_regclass(v_old_name);
  IF v_old_oid IS NULL THEN
    RAISE EXCEPTION 'Original outbox id sequence % is not accessible; no changes made', v_old_name;
  END IF;

  SELECT pg_get_serial_sequence('public."PrivateD1SyncOutbox"', 'id') INTO v_attached_name;
  IF v_attached_name IS NOT NULL THEN
    IF to_regclass(v_attached_name) = v_old_oid THEN
      RAISE NOTICE 'Outbox sequence is already correctly owned by id: %; nothing to repair', v_attached_name;
      RETURN;
    ELSE
      RAISE EXCEPTION 'A different sequence is owned by Outbox.id (%), default points to (%). Manual review required', v_attached_name, v_old_name;
    END IF;
  END IF;

  EXECUTE format('SELECT last_value FROM %s', v_old_oid::regclass) INTO v_old_last;
  SELECT COALESCE(MAX("id"), 0), COALESCE(MAX("revision"), 0)
    INTO v_max_id, v_max_revision FROM public."PrivateD1SyncOutbox";

  -- Never move/drop/alter the old recovery sequence: another schema may use it.
  -- Use a dedicated new sequence in the Outbox table's schema, allowing OWNED BY.
  IF to_regclass('public."PrivateD1SyncOutbox_repaired_id_seq_20261116"') IS NULL THEN
    CREATE SEQUENCE public."PrivateD1SyncOutbox_repaired_id_seq_20261116" AS bigint START WITH 1 INCREMENT BY 1;
  END IF;
  v_new_oid := to_regclass('public."PrivateD1SyncOutbox_repaired_id_seq_20261116"');
  IF EXISTS (
    SELECT 1 FROM pg_depend d
    WHERE d.classid = 'pg_class'::regclass
      AND d.objid = v_new_oid
      AND d.deptype IN ('a','i')
      AND (d.refobjid <> v_table OR d.refobjsubid <> v_attnum)
  ) THEN
    RAISE EXCEPTION 'New sequence already owned by another table/column; no changes made';
  END IF;
  EXECUTE format('SELECT last_value FROM %s', v_new_oid::regclass) INTO v_new_last;

  -- Sequences are non-transactional; advancing past the highest observed old
  -- allocation/revision avoids reused IDs or stale Worker revisions.
  v_safe_start := GREATEST(
    COALESCE(v_old_last, 0), COALESCE(v_new_last, 0),
    COALESCE(v_max_id, 0), COALESCE(v_max_revision, 0), 1
  );
  IF v_safe_start = 9223372036854775807 THEN
    RAISE EXCEPTION 'Sequence at BIGINT maximum; manual intervention required';
  END IF;
  PERFORM setval(v_new_oid::regclass, v_safe_start, true);

  ALTER SEQUENCE public."PrivateD1SyncOutbox_repaired_id_seq_20261116"
    OWNED BY public."PrivateD1SyncOutbox"."id";
  ALTER TABLE public."PrivateD1SyncOutbox"
    ALTER COLUMN "id" SET DEFAULT nextval('public."PrivateD1SyncOutbox_repaired_id_seq_20261116"'::regclass);

  IF pg_get_serial_sequence('public."PrivateD1SyncOutbox"', 'id') IS NULL THEN
    RAISE EXCEPTION 'Post-repair ownership verification failed; rolling back';
  END IF;
  RAISE NOTICE 'Outbox sequence repair complete; preserved old sequence; floor=%; canonical rows unchanged', v_safe_start;
END;
$repair$;
COMMIT;
