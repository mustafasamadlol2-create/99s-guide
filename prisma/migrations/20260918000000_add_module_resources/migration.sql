-- CreateTable
CREATE TABLE "ModuleResource" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "multipartUploadId" TEXT,
    "uploadExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModuleResource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModuleResource_storagePath_key" ON "ModuleResource"("storagePath");

-- CreateIndex
CREATE INDEX "ModuleResource_moduleId_status_createdAt_idx"
  ON "ModuleResource"("moduleId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ModuleResource_status_uploadExpiresAt_idx"
  ON "ModuleResource"("status", "uploadExpiresAt");