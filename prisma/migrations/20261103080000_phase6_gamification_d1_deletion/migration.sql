-- Phase 6: privacy-safe deletion of the disposable private Gamification D1
-- snapshot after a canonical User deletion. This changes no Study Points rules
-- and does not delete/alter any canonical Gamification records.
CREATE OR REPLACE FUNCTION "phase6_gamification_deletion_outbox"()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM "phase3_enqueue_outbox"(
    'GamificationSnapshot',
    'delete',
    jsonb_build_object('id', OLD."id", 'userId', OLD."id"),
    NULL
  );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "phase6_gamification_snapshot_delete" ON "User";
CREATE TRIGGER "phase6_gamification_snapshot_delete"
AFTER DELETE ON "User"
FOR EACH ROW EXECUTE FUNCTION "phase6_gamification_deletion_outbox"();
