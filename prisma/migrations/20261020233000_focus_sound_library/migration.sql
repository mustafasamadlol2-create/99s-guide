CREATE TABLE IF NOT EXISTS "FocusSound" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FocusSound_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FocusSound_storagePath_key"
  ON "FocusSound"("storagePath");
CREATE INDEX IF NOT EXISTS "FocusSound_isEnabled_sortOrder_createdAt_idx"
  ON "FocusSound"("isEnabled", "sortOrder", "createdAt");
CREATE INDEX IF NOT EXISTS "FocusSound_createdById_createdAt_idx"
  ON "FocusSound"("createdById", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FocusSound_createdById_fkey'
  ) THEN
    ALTER TABLE "FocusSound"
      ADD CONSTRAINT "FocusSound_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
