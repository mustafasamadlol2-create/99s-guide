-- 99's Guide — D1 metadata mirror for private module resources
-- Apply after the initial shared-content schema.

CREATE TABLE IF NOT EXISTS "ModuleResource" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "moduleId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "storagePath" TEXT
);

CREATE INDEX IF NOT EXISTS "ModuleResource_module_status_createdAt_idx"
  ON "ModuleResource" ("moduleId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "ModuleResource_status_idx"
  ON "ModuleResource" ("status");