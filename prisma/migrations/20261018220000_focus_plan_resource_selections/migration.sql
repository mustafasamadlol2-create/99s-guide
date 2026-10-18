ALTER TABLE "FocusPlanItem"
ADD COLUMN "resourceSelections" JSONB NOT NULL DEFAULT '[]'::jsonb;
