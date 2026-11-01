-- Phase 3 auth hotfix
-- 1) Do not depend on pg_get_serial_sequence()/nextval() for the outbox id.
--    Let PostgreSQL allocate the BIGSERIAL id, then stamp revision=id in the
--    same transaction before the row can be observed by the drainer.
-- 2) Avoid enqueueing a full user replica for volatile presence-only updates
--    (isOnline/lastActive/lastSeen/socketId). Those fields change on every
--    socket connect/disconnect and are not needed for auth/profile correctness.

CREATE OR REPLACE FUNCTION "phase3_enqueue_outbox"(
  p_entity TEXT,
  p_operation TEXT,
  p_key JSONB,
  p_data JSONB
) RETURNS VOID AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO "PrivateD1SyncOutbox"
    ("entity", "operation", "key", "revision", "data", "attempts", "lastError", "nextAttemptAt", "updatedAt")
  VALUES
    (p_entity, p_operation, p_key, 0, p_data, 0, NULL, NOW(), NOW())
  RETURNING "id" INTO v_id;

  UPDATE "PrivateD1SyncOutbox"
  SET "revision" = v_id
  WHERE "id" = v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "phase3_user_trigger"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM "phase3_enqueue_outbox"(
      'UserAuthReplica',
      'delete',
      jsonb_build_object('id', OLD."id"),
      NULL
    );
    RETURN OLD;
  END IF;

  -- Presence-only writes are extremely frequent and do not need a D1 auth
  -- replica refresh. Skip them to keep OAuth/login writes lightweight.
  IF TG_OP = 'UPDATE' AND
     OLD."email" IS NOT DISTINCT FROM NEW."email" AND
     OLD."profileEmail" IS NOT DISTINCT FROM NEW."profileEmail" AND
     OLD."name" IS NOT DISTINCT FROM NEW."name" AND
     OLD."avatar" IS NOT DISTINCT FROM NEW."avatar" AND
     OLD."avatarUrl" IS NOT DISTINCT FROM NEW."avatarUrl" AND
     OLD."signature" IS NOT DISTINCT FROM NEW."signature" AND
     OLD."role" IS NOT DISTINCT FROM NEW."role" AND
     OLD."accountStatus" IS NOT DISTINCT FROM NEW."accountStatus" AND
     OLD."isPrimaryOwner" IS NOT DISTINCT FROM NEW."isPrimaryOwner" AND
     OLD."emailVerified" IS NOT DISTINCT FROM NEW."emailVerified" AND
     OLD."sessionVersion" IS NOT DISTINCT FROM NEW."sessionVersion" AND
     OLD."studentGroup" IS NOT DISTINCT FROM NEW."studentGroup" AND
     OLD."totalPoints" IS NOT DISTINCT FROM NEW."totalPoints" AND
     OLD."level" IS NOT DISTINCT FROM NEW."level" AND
     OLD."levelBadge" IS NOT DISTINCT FROM NEW."levelBadge" AND
     OLD."streakDays" IS NOT DISTINCT FROM NEW."streakDays" AND
     OLD."totalTimeSpent" IS NOT DISTINCT FROM NEW."totalTimeSpent" AND
     OLD."preferences" IS NOT DISTINCT FROM NEW."preferences"
  THEN
    RETURN NEW;
  END IF;

  PERFORM "phase3_enqueue_user_snapshot"(NEW."id");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "phase3_user_d1_mirror" ON "User";
CREATE TRIGGER "phase3_user_d1_mirror"
AFTER INSERT OR UPDATE OR DELETE ON "User"
FOR EACH ROW EXECUTE FUNCTION "phase3_user_trigger"();
