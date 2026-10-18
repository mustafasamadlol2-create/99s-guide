-- Phase 4 repair: some production databases may have a migration-history row
-- without the resourceSelections column being present (or fully constrained).
-- This migration is intentionally idempotent and makes the canonical Focus
-- Plan storage safe before the API accepts Phase 4 planner writes.
ALTER TABLE "FocusPlanItem"
ADD COLUMN IF NOT EXISTS "resourceSelections" JSONB;

UPDATE "FocusPlanItem"
SET "resourceSelections" = '[]'::jsonb
WHERE "resourceSelections" IS NULL;

ALTER TABLE "FocusPlanItem"
ALTER COLUMN "resourceSelections" SET DEFAULT '[]'::jsonb;

ALTER TABLE "FocusPlanItem"
ALTER COLUMN "resourceSelections" SET NOT NULL;
