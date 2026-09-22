-- Module Resources support files up to 5 GiB. PostgreSQL INTEGER is
-- limited to ~2 GiB, so widen the existing column without losing data.
ALTER TABLE "ModuleResource"
  ALTER COLUMN "fileSizeBytes" TYPE BIGINT
  USING "fileSizeBytes"::bigint;
