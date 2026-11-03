-- Phase 4: transaction-safe progress read replicas.
-- Supabase/PostgreSQL remains canonical. These triggers enqueue Cloudflare D1 projections.

CREATE OR REPLACE FUNCTION "phase4_lecture_progress_trigger"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM "phase3_enqueue_outbox"(
      'LectureProgress',
      'delete',
      jsonb_build_object('userId', OLD."userId", 'lectureId', OLD."lectureId"),
      NULL
    );
    RETURN OLD;
  END IF;

  PERFORM "phase3_enqueue_outbox"(
    'LectureProgress',
    'upsert',
    jsonb_build_object('userId', NEW."userId", 'lectureId', NEW."lectureId"),
    jsonb_build_object(
      'userId', NEW."userId",
      'lectureId', NEW."lectureId",
      'pdfCompleted', NEW."pdfCompleted",
      'notesCompleted', NEW."notesCompleted",
      'videoCompleted', NEW."videoCompleted",
      'flashcardsCompleted', NEW."flashcardsCompleted",
      'quizCompleted', NEW."quizCompleted",
      'quizScore', NEW."quizScore",
      'pdfCompletedAt', NEW."pdfCompletedAt",
      'notesCompletedAt', NEW."notesCompletedAt",
      'videoCompletedAt', NEW."videoCompletedAt",
      'flashcardsCompletedAt', NEW."flashcardsCompletedAt",
      'quizCompletedAt', NEW."quizCompletedAt",
      'lectureCompletedAt', NEW."lectureCompletedAt",
      'lastAccessed', NEW."lastAccessed"
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "phase4_lecture_progress_d1_mirror" ON "LectureProgress";
CREATE TRIGGER "phase4_lecture_progress_d1_mirror"
AFTER INSERT OR UPDATE OR DELETE ON "LectureProgress"
FOR EACH ROW EXECUTE FUNCTION "phase4_lecture_progress_trigger"();

CREATE OR REPLACE FUNCTION "phase4_flashcard_progress_trigger"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM "phase3_enqueue_outbox"(
      'FlashcardProgress', 'delete', jsonb_build_object('id', OLD."id"), NULL
    );
    RETURN OLD;
  END IF;

  PERFORM "phase3_enqueue_outbox"(
    'FlashcardProgress',
    'upsert',
    jsonb_build_object('id', NEW."id"),
    jsonb_build_object(
      'id', NEW."id",
      'userId', NEW."userId",
      'flashcardId', NEW."flashcardId",
      'status', NEW."status",
      'updatedAt', NEW."updatedAt"
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "phase4_flashcard_progress_d1_mirror" ON "FlashcardProgress";
CREATE TRIGGER "phase4_flashcard_progress_d1_mirror"
AFTER INSERT OR UPDATE OR DELETE ON "FlashcardProgress"
FOR EACH ROW EXECUTE FUNCTION "phase4_flashcard_progress_trigger"();

CREATE OR REPLACE FUNCTION "phase4_user_progress_trigger"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM "phase3_enqueue_outbox"(
      'UserProgress', 'delete', jsonb_build_object('id', OLD."id"), NULL
    );
    RETURN OLD;
  END IF;

  PERFORM "phase3_enqueue_outbox"(
    'UserProgress',
    'upsert',
    jsonb_build_object('id', NEW."id"),
    jsonb_build_object(
      'id', NEW."id",
      'userId', NEW."userId",
      'materialId', NEW."materialId",
      'hasViewed', NEW."hasViewed",
      'isCompleted', NEW."isCompleted",
      'createdAt', NEW."createdAt",
      'updatedAt', NEW."updatedAt"
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "phase4_user_progress_d1_mirror" ON "UserProgress";
CREATE TRIGGER "phase4_user_progress_d1_mirror"
AFTER INSERT OR UPDATE OR DELETE ON "UserProgress"
FOR EACH ROW EXECUTE FUNCTION "phase4_user_progress_trigger"();

CREATE OR REPLACE FUNCTION "phase4_video_progress_trigger"()
RETURNS TRIGGER AS $$
DECLARE
  v_lecture_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM "phase3_enqueue_outbox"(
      'VideoWatchProgress', 'delete', jsonb_build_object('id', OLD."id"), NULL
    );
    RETURN OLD;
  END IF;

  SELECT "lectureId" INTO v_lecture_id
  FROM "Material"
  WHERE "id" = NEW."materialId";

  PERFORM "phase3_enqueue_outbox"(
    'VideoWatchProgress',
    'upsert',
    jsonb_build_object('id', NEW."id"),
    jsonb_build_object(
      'id', NEW."id",
      'userId', NEW."userId",
      'materialId', NEW."materialId",
      'lectureId', v_lecture_id,
      'sessionId', NEW."sessionId",
      'durationSeconds', NEW."durationSeconds",
      'verifiedMilliseconds', NEW."verifiedMilliseconds",
      'lastPositionSeconds', NEW."lastPositionSeconds",
      'lastHeartbeatAt', NEW."lastHeartbeatAt",
      'lastPlayerState', NEW."lastPlayerState",
      'lastPlaybackRate', NEW."lastPlaybackRate",
      'completedAt', NEW."completedAt",
      'createdAt', NEW."createdAt",
      'updatedAt', NEW."updatedAt"
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "phase4_video_progress_d1_mirror" ON "VideoWatchProgress";
CREATE TRIGGER "phase4_video_progress_d1_mirror"
AFTER INSERT OR UPDATE OR DELETE ON "VideoWatchProgress"
FOR EACH ROW EXECUTE FUNCTION "phase4_video_progress_trigger"();
