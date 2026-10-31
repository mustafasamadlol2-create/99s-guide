-- Phase 3: transaction-safe canonical Supabase -> Cloudflare private D1 outbox.
-- Supabase remains authoritative. These triggers only enqueue non-sensitive read replicas.

CREATE OR REPLACE FUNCTION "phase3_enqueue_outbox"(
  p_entity TEXT,
  p_operation TEXT,
  p_key JSONB,
  p_data JSONB
) RETURNS VOID AS $$
DECLARE
  v_revision BIGINT;
BEGIN
  v_revision := nextval(pg_get_serial_sequence('"PrivateD1SyncOutbox"', 'id'));
  INSERT INTO "PrivateD1SyncOutbox"
    ("id", "entity", "operation", "key", "revision", "data", "attempts", "lastError", "nextAttemptAt", "updatedAt")
  VALUES
    (v_revision, p_entity, p_operation, p_key, v_revision, p_data, 0, NULL, NOW(), NOW());
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "phase3_enqueue_user_snapshot"(p_user_id TEXT)
RETURNS VOID AS $$
DECLARE
  u "User"%ROWTYPE;
  has_apple BOOLEAN;
BEGIN
  SELECT * INTO u FROM "User" WHERE "id" = p_user_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM "OAuthIdentity"
    WHERE "userId" = p_user_id AND "provider" = 'apple'
  ) INTO has_apple;

  PERFORM "phase3_enqueue_outbox"(
    'UserAuthReplica',
    'upsert',
    jsonb_build_object('id', u."id"),
    jsonb_build_object(
      'id', u."id",
      'email', u."email",
      'profileEmail', u."profileEmail",
      'role', u."role",
      'sessionVersion', u."sessionVersion",
      'name', COALESCE(u."name", ''),
      'avatar', COALESCE(u."avatar", ''),
      'avatarUrl', COALESCE(u."avatarUrl", u."avatar", ''),
      'signature', COALESCE(u."signature", ''),
      'totalPoints', COALESCE(u."totalPoints", 0),
      'level', u."level",
      'levelBadge', u."levelBadge",
      'streakDays', COALESCE(u."streakDays", 0),
      'totalTimeSpent', COALESCE(u."totalTimeSpent", 0),
      'lastActive', u."lastActive",
      'lastSeen', u."lastSeen",
      'createdAt', u."createdAt",
      'updatedAt', u."updatedAt",
      'accountStatus', u."accountStatus",
      'isOnline', u."isOnline",
      'studentGroup', u."studentGroup",
      'isPrimaryOwner', u."isPrimaryOwner",
      'emailVerified', u."emailVerified",
      'hasAppleIdentity', has_apple,
      'preferences', u."preferences"
    )
  );
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

  PERFORM "phase3_enqueue_user_snapshot"(NEW."id");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "phase3_user_d1_mirror" ON "User";
CREATE TRIGGER "phase3_user_d1_mirror"
AFTER INSERT OR UPDATE OR DELETE ON "User"
FOR EACH ROW EXECUTE FUNCTION "phase3_user_trigger"();

CREATE OR REPLACE FUNCTION "phase3_oauth_identity_trigger"()
RETURNS TRIGGER AS $$
DECLARE
  affected_user TEXT;
BEGIN
  affected_user := CASE WHEN TG_OP = 'DELETE' THEN OLD."userId" ELSE NEW."userId" END;
  PERFORM "phase3_enqueue_user_snapshot"(affected_user);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "phase3_oauth_identity_d1_mirror" ON "OAuthIdentity";
CREATE TRIGGER "phase3_oauth_identity_d1_mirror"
AFTER INSERT OR UPDATE OR DELETE ON "OAuthIdentity"
FOR EACH ROW EXECUTE FUNCTION "phase3_oauth_identity_trigger"();

CREATE OR REPLACE FUNCTION "phase3_user_ban_trigger"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM "phase3_enqueue_outbox"(
      'UserBan',
      'delete',
      jsonb_build_object('id', OLD."id"),
      NULL
    );
    RETURN OLD;
  END IF;

  PERFORM "phase3_enqueue_outbox"(
    'UserBan',
    'upsert',
    jsonb_build_object('id', NEW."id"),
    jsonb_build_object(
      'id', NEW."id",
      'userId', NEW."userId",
      'reason', NEW."reason",
      'startTime', NEW."startTime",
      'endTime', NEW."endTime",
      'isPermanent', NEW."isPermanent",
      'createdBy', NEW."createdBy",
      'createdAt', NEW."createdAt"
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "phase3_user_ban_d1_mirror" ON "UserBan";
CREATE TRIGGER "phase3_user_ban_d1_mirror"
AFTER INSERT OR UPDATE OR DELETE ON "UserBan"
FOR EACH ROW EXECUTE FUNCTION "phase3_user_ban_trigger"();
