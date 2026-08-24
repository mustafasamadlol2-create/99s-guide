-- Add a persistent, database-enforced Primary Owner status.
ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "isPrimaryOwner" BOOLEAN NOT NULL DEFAULT false;

-- Clear any legacy/partial value before enforcing the new invariant. The
-- transaction rolls back if the verified target cannot be identified.
UPDATE "User"
SET "isPrimaryOwner" = false
WHERE "isPrimaryOwner" = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'User_primary_owner_must_be_owner_check'
      AND conrelid = '"User"'::regclass
  ) THEN
    ALTER TABLE "User"
    ADD CONSTRAINT "User_primary_owner_must_be_owner_check"
    CHECK ("isPrimaryOwner" = false OR "role" = 'owner');
  END IF;
END $$;

-- PostgreSQL partial uniqueness gives the status a strict cardinality of at
-- most one. The data migration below establishes the required one row.
CREATE UNIQUE INDEX IF NOT EXISTS "User_one_primary_owner_idx"
ON "User" ("isPrimaryOwner")
WHERE "isPrimaryOwner" = true;

-- Identify the existing account by its exact stored name and the visible
-- email prefix. The full email is read from Supabase; it is never invented or
-- persisted as a hardcoded authorization rule. Fail closed on ambiguity.
DO $$
DECLARE
  matched_count INTEGER;
  matched_id TEXT;
  matched_email TEXT;
BEGIN
  SELECT COUNT(*) INTO matched_count
  FROM "User"
  WHERE "name" = 'مصطفى ياسر كمال رشيد'
    AND "role" = 'owner'
    AND lower("email") LIKE 'mostafa.yasir24001@%';

  IF matched_count <> 1 THEN
    RAISE EXCEPTION
      'Primary Owner migration expected exactly one matching owner, found %',
      matched_count;
  END IF;

  SELECT "id", "email" INTO matched_id, matched_email
  FROM "User"
  WHERE "name" = 'مصطفى ياسر كمال رشيد'
    AND "role" = 'owner'
    AND lower("email") LIKE 'mostafa.yasir24001@%';

  UPDATE "User"
  SET "isPrimaryOwner" = true
  WHERE "id" = matched_id;

  RAISE NOTICE 'Primary Owner assigned to existing user % (%).', matched_id, matched_email;
END $$;
