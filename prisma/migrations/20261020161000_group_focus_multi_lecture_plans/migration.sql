-- Phase 5 additive Group Focus study-plan expansion.
-- PostgreSQL remains canonical; existing single-Lecture columns stay in place
-- as the active/effective Lecture used by realtime authorization and summaries.
ALTER TABLE "GroupFocusRoom"
  ADD COLUMN IF NOT EXISTS "sharedStudyPlan" JSONB;

ALTER TABLE "GroupFocusMembership"
  ADD COLUMN IF NOT EXISTS "studyPlan" JSONB;

-- Preserve existing rooms/memberships as one-item legacy plans. Resource lists
-- remain empty until the user explicitly saves a resource-aware plan.
UPDATE "GroupFocusRoom"
SET "sharedStudyPlan" = jsonb_build_array(
  jsonb_build_object(
    'lectureId', "sharedLectureId",
    'sequence', 1,
    'resources', '[]'::jsonb
  )
)
WHERE "mode" = 'SHARED_LECTURE'
  AND "sharedLectureId" IS NOT NULL
  AND "sharedStudyPlan" IS NULL;

UPDATE "GroupFocusMembership"
SET "studyPlan" = jsonb_build_array(
  jsonb_build_object(
    'lectureId', "selectedLectureId",
    'sequence', 1,
    'resources', '[]'::jsonb
  )
)
WHERE "selectedLectureId" IS NOT NULL
  AND "studyPlan" IS NULL;
